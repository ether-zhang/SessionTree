//! Codex storage adapter: local files, SQLite metadata, bounded excerpts and change detection.
mod changes;
pub mod preview;
use anyhow::{Result, bail};
use changes::{ChangeTracker, Changes, path_key};
use chrono::{DateTime, SecondsFormat, Utc};
use preview::{PreviewState, Previews};
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::{Map, Value, json};
use session_tree_core::Node;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, Metadata},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};

pub fn valid_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
pub fn key(id: &str) -> String {
    format!("codex:{id}")
}
fn text<'a>(value: &'a Value, name: &str) -> &'a str {
    value[name].as_str().unwrap_or("")
}
fn first<'a>(items: &[&'a str]) -> &'a str {
    items
        .iter()
        .copied()
        .find(|value| !value.is_empty())
        .unwrap_or("")
}
fn clip(value: &str) -> String {
    if value.chars().count() > 240 {
        value.chars().take(239).collect::<String>() + "…"
    } else {
        value.into()
    }
}
fn iso(value: SystemTime) -> String {
    DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn timestamp(value: &Value, base: &str) -> Option<String> {
    let millis = value[format!("{base}_ms")]
        .as_i64()
        .or_else(|| value[base].as_i64().and_then(|v| v.checked_mul(1000)));
    millis
        .and_then(DateTime::<Utc>::from_timestamp_millis)
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Millis, true))
}
fn subagent(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            map.get("subagent").is_some_and(truthy) || map.get("subAgent").is_some_and(truthy)
        }
        Value::String(value) => {
            ["subagent", "sub_agent", "thread_spawn"].contains(&value.to_lowercase().as_str())
                || serde_json::from_str::<Value>(value)
                    .ok()
                    .filter(|v| !v.is_string())
                    .is_some_and(|value| subagent(&value))
        }
        _ => false,
    }
}
pub fn rollout_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("rollout-")
                && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
        })
}
#[derive(Clone, Debug, PartialEq)]
pub struct Stamp {
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub identity: String,
}
impl Stamp {
    pub fn new(info: &Metadata, _path: &Path) -> Self {
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            format!("{}:{}:{:?}", info.dev(), info.ino(), info.created())
        };
        #[cfg(not(unix))]
        let identity = {
            use std::hash::{Hash, Hasher};
            same_file::Handle::from_path(_path)
                .map(|handle| {
                    let mut hash = std::collections::hash_map::DefaultHasher::new();
                    handle.hash(&mut hash);
                    format!("{}:{:?}", hash.finish(), info.created())
                })
                .unwrap_or_else(|_| format!("{:?}", info.created()))
        };
        Self {
            size: info.len(),
            modified: info.modified().ok(),
            identity,
        }
    }
}
struct Cached {
    stamp: Stamp,
    meta: Value,
    preview: Option<PreviewState>,
    record: Node,
    issues: Vec<Value>,
}
struct CachedFirstReply {
    stamp: Stamp,
    reply: preview::FirstReply,
}
#[derive(Default, Clone, Debug, PartialEq)]
pub struct Metrics {
    pub scans: usize,
    pub metadata_reads: usize,
    pub body_reads: usize,
    pub database_reads: usize,
    pub directory_scans: usize,
    pub database_checks: usize,
}
pub struct CodexAdapter {
    home: PathBuf,
    home_alias: PathBuf,
    changes: ChangeTracker,
    cache: BTreeMap<PathBuf, Cached>,
    first_replies: BTreeMap<String, CachedFirstReply>,
    files: BTreeMap<PathBuf, bool>,
    names: BTreeMap<String, Value>,
    state: Vec<Value>,
    names_issues: Vec<Value>,
    state_issues: Vec<Value>,
    initialized: bool,
    focused: Option<BTreeSet<String>>,
    seeded: BTreeMap<String, Node>,
    preview_budget: usize,
    pub metrics: Metrics,
}

fn reader(path: &Path) -> Result<Box<dyn Read>> {
    let file = File::open(path)?;
    Ok(if path.extension().is_some_and(|ext| ext == "zst") {
        Box::new(zstd::stream::read::Decoder::new(file)?)
    } else {
        Box::new(file)
    })
}
fn read_meta(path: &Path) -> Result<Value> {
    let mut reader = BufReader::new(reader(path)?.take(4 * 1024 * 1024 + 1));
    let mut total = 0;
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        if reader.read_until(b'\n', &mut bytes)? == 0 {
            break;
        }
        total += bytes.len();
        if total > 4 * 1024 * 1024 {
            bail!("Session metadata exceeds the 4 MiB read limit.");
        }
        if let Ok(entry) = serde_json::from_slice::<Value>(&bytes)
            && entry["type"] == "session_meta"
            && valid_id(text(&entry["payload"], "id"))
        {
            return Ok(entry["payload"].clone());
        }
    }
    bail!("No valid session metadata found.")
}
fn discover(directory: &Path, archived: bool, files: &mut BTreeMap<PathBuf, bool>) -> Result<()> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            discover(&entry.path(), archived, files)?;
        } else if kind.is_file() && rollout_name(&entry.path()) {
            files.insert(entry.path(), archived);
        }
    }
    Ok(())
}
fn read_names(home: &Path) -> Result<BTreeMap<String, Value>> {
    let file = match File::open(home.join("session_index.jsonl")) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e.into()),
    };
    let mut names = BTreeMap::new();
    for line in BufReader::new(file).lines() {
        if let Ok(value) = serde_json::from_str::<Value>(&line?)
            && valid_id(text(&value, "id"))
            && value["thread_name"].is_string()
        {
            names.insert(text(&value, "id").into(), value);
        }
    }
    Ok(names)
}
fn read_state(path: Option<&Path>) -> Result<Vec<Value>> {
    let Some(path) = path else {
        return Ok(vec![]);
    };
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(200))?;
    let columns = db
        .prepare("PRAGMA table_info(threads)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;
    let wanted = [
        "id",
        "rollout_path",
        "title",
        "name",
        "cwd",
        "source",
        "archived",
        "created_at",
        "updated_at",
        "created_at_ms",
        "updated_at_ms",
    ]
    .into_iter()
    .filter(|column| columns.contains(*column))
    .collect::<Vec<_>>();
    let mut statement = db.prepare(&format!("SELECT {} FROM threads", wanted.join(", ")))?;
    let rows = statement
        .query_map([], |row| {
            let mut value = Map::new();
            for (index, name) in wanted.iter().enumerate() {
                let item = match row.get_ref(index)? {
                    ValueRef::Null | ValueRef::Blob(_) => Value::Null,
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Real(v) => json!(v),
                    ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                };
                value.insert((*name).into(), item);
            }
            Ok(Value::Object(value))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

impl CodexAdapter {
    pub fn begin_request(&mut self) {
        self.preview_budget = 64 * 1024 * 1024;
    }
    pub fn seed(&mut self, index: &session_tree_core::Index) {
        self.seeded = index
            .nodes
            .iter()
            .filter(|node| node.agent == "codex" && !node.missing)
            .filter_map(|node| node.native_id.clone().map(|id| (id, node.clone())))
            .collect();
    }
    pub fn observe(&mut self, native_ids: &[String]) -> bool {
        let wanted: BTreeSet<String> = native_ids.iter().cloned().collect();
        let changed = self.focused.as_ref() != Some(&wanted);
        let paths = self
            .cache
            .iter()
            .filter(|(_, cached)| {
                cached
                    .record
                    .native_id
                    .as_ref()
                    .is_some_and(|id| wanted.contains(id))
            })
            .map(|(path, _)| (path_key(path), path.clone()))
            .collect();
        self.focused = Some(wanted);
        self.changes.focus(paths, changed);
        changed
    }
    pub fn new(home: PathBuf) -> Self {
        let home_alias = home.clone();
        // FSEvents reports canonical paths, including /private/var for macOS temp roots.
        #[cfg(unix)]
        let home = fs::canonicalize(&home).unwrap_or(home);
        Self {
            changes: ChangeTracker::new(&home),
            home,
            home_alias,
            cache: BTreeMap::new(),
            first_replies: BTreeMap::new(),
            files: BTreeMap::new(),
            names: BTreeMap::new(),
            state: vec![],
            names_issues: vec![],
            state_issues: vec![],
            initialized: false,
            focused: None,
            seeded: BTreeMap::new(),
            preview_budget: usize::MAX,
            metrics: Metrics::default(),
        }
    }
    pub fn first_reply(&mut self, id: &str) -> preview::FirstReply {
        if !valid_id(id) {
            return preview::FirstReply::Unavailable;
        }
        let path = self
            .cache
            .iter()
            .filter(|(_, cached)| {
                !cached.record.subagent && cached.record.native_id.as_deref() == Some(id)
            })
            .max_by_key(|(_, cached)| cached.stamp.modified)
            .map(|(path, _)| path.clone());
        let Some(path) = path else {
            return preview::FirstReply::Unavailable;
        };
        let Ok(info) = fs::metadata(&path) else {
            return preview::FirstReply::Unavailable;
        };
        let stamp = Stamp::new(&info, &path);
        if let Some(cached) = self.first_replies.get(id)
            && (cached.stamp == stamp
                || (matches!(cached.reply, preview::FirstReply::Available { .. })
                    && cached.stamp.identity == stamp.identity
                    && stamp.size > cached.stamp.size))
        {
            return cached.reply.clone();
        }
        self.metrics.body_reads += 1;
        let reply = preview::read_first_reply(&path).unwrap_or(preview::FirstReply::Unavailable);
        if matches!(reply, preview::FirstReply::Unavailable) {
            return reply;
        }
        if self.first_replies.len() >= 64 && !self.first_replies.contains_key(id) {
            self.first_replies.pop_first();
        }
        self.first_replies.insert(
            id.into(),
            CachedFirstReply {
                stamp,
                reply: reply.clone(),
            },
        );
        reply
    }

    pub fn scan(&mut self, force: bool) -> Result<Option<(Vec<Node>, Vec<Value>)>> {
        self.metrics.database_checks += 1;
        let Some(mut change) = self.changes.take(force)? else {
            return Ok(None);
        };
        if self.focused.is_none() && force {
            change.discover = true;
            change.database = false;
            change.full = true;
        }
        match self.scan_changes(change) {
            Ok(value) => Ok(Some(value)),
            Err(error) => {
                self.changes.retry();
                Err(error)
            }
        }
    }
    fn scan_changes(&mut self, change: Changes) -> Result<(Vec<Node>, Vec<Value>)> {
        fs::read_dir(&self.home)?;
        self.metrics.scans += 1;
        if change.names || !self.initialized {
            self.names_issues.clear();
            match read_names(&self.home) {
                Ok(names) => self.names = names,
                Err(error) => self
                    .names_issues
                    .push(json!({"kind":"name-index-unavailable","message":error.to_string()})),
            }
        }
        if change.state || !self.initialized {
            self.metrics.database_reads += 1;
            self.state_issues.clear();
            match read_state(change.state_path.as_deref()) {
                Ok(state)=>self.state=state,
                Err(_)=>self.state_issues.push(json!({"kind":"state-unavailable","message":"会话数据库暂不可读，已使用本地会话文件和名称索引。"})),
            }
        }
        let mut issues = self
            .names_issues
            .iter()
            .chain(&self.state_issues)
            .cloned()
            .collect::<Vec<_>>();
        let rows: BTreeMap<_, _> = self
            .state
            .iter()
            .filter(|row| valid_id(text(row, "id")))
            .map(|row| (text(row, "id").to_owned(), row.clone()))
            .collect();
        let mut files = if change.discover || !self.initialized {
            let mut files = BTreeMap::new();
            if !change.database {
                self.metrics.directory_scans += 1;
                discover(&self.home.join("sessions"), false, &mut files)?;
                discover(&self.home.join("archived_sessions"), true, &mut files)?;
            }
            files
        } else {
            self.files.clone()
        };
        let mut known: BTreeSet<_> = files.keys().map(|path| path_key(path)).collect();
        for (key, path) in &change.paths {
            if known.insert(key.clone()) {
                files.insert(
                    path.clone(),
                    path.starts_with(self.home.join("archived_sessions")),
                );
            }
        }
        let mut ids_by_path = BTreeMap::new();
        for row in rows.values() {
            let value = text(row, "rollout_path");
            if value.is_empty() {
                continue;
            }
            let path = Path::new(value);
            let path = path
                .strip_prefix(&self.home_alias)
                .map(|suffix| self.home.join(suffix))
                .unwrap_or_else(|_| path.to_path_buf());
            let mut compressed = path.as_os_str().to_os_string();
            compressed.push(".zst");
            let path = if known.contains(&path_key(Path::new(&compressed)))
                || (!known.contains(&path_key(&path))
                    && !path.exists()
                    && Path::new(&compressed).exists())
            {
                PathBuf::from(compressed.clone())
            } else {
                path
            };
            ids_by_path.insert(path_key(&path), text(row, "id").to_owned());
            if !known.contains(&path_key(&path))
                && !known.contains(&path_key(Path::new(&compressed)))
            {
                known.insert(path_key(&path));
                files.insert(path, truthy(&row["archived"]));
            }
        }
        if change.database {
            files.retain(|path, _| ids_by_path.contains_key(&path_key(path)));
        }
        let mut records = BTreeMap::new();
        let mut seen = BTreeSet::new();
        let mut preview_budget = self.preview_budget;
        for (path, archived) in &files {
            let previous = self.cache.get(path);
            let check =
                change.full || previous.is_none() || change.paths.contains_key(&path_key(path));
            let stamp = if check {
                fs::metadata(path).map(|info| (Stamp::new(&info, path), Some(info)))
            } else {
                Ok((previous.unwrap().stamp.clone(), None))
            };
            let result: Result<Cached> = (|| {
                let (stamp, info) = stamp?;
                let unchanged = previous.is_some_and(|previous| previous.stamp == stamp);
                let appended = previous.is_some_and(|previous| {
                    stamp.size > previous.stamp.size && stamp.identity == previous.stamp.identity
                });
                let meta = if unchanged || appended {
                    previous.unwrap().meta.clone()
                } else {
                    if let Some(saved) = ids_by_path
                        .get(&path_key(path))
                        .and_then(|id| self.seeded.get(id))
                    {
                        let parent = saved
                            .parent_id
                            .as_deref()
                            .and_then(|id| id.strip_prefix("codex:"));
                        json!({"id":saved.native_id,"timestamp":saved.extra.get("createdAt"),"cwd":saved.workspace,
                            "agent_nickname":saved.title,"forked_from_id":if saved.relation.as_deref()==Some("fork"){parent}else{None},
                            "parent_thread_id":if saved.relation.as_deref()==Some("spawn"){parent}else{None},
                            "source":if saved.subagent{json!({"subagent":true})}else{json!("vscode")}})
                    } else {
                        self.metrics.metadata_reads += 1;
                        read_meta(path)?
                    }
                };
                let id = text(&meta, "id");
                let row = rows.get(id).unwrap_or(&Value::Null);
                let name = self.names.get(id).unwrap_or(&Value::Null);
                let spawned = first(&[
                    text(&meta, "parent_thread_id"),
                    meta.pointer("/source/subagent/thread_spawn/parent_thread_id")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ]);
                let forked = text(&meta, "forked_from_id");
                let parent = first(&[forked, spawned]);
                let is_subagent =
                    !spawned.is_empty() || subagent(&meta["source"]) || subagent(&row["source"]);
                let mut preview = if unchanged {
                    previous.and_then(|previous| previous.preview.clone())
                } else {
                    None
                };
                let mut file_issues = if unchanged {
                    previous.unwrap().issues.clone()
                } else {
                    vec![]
                };
                let focused = self.focused.as_ref().is_none_or(|ids| ids.contains(id));
                let cost = if path.extension().is_some_and(|ext| ext == "zst") {
                    64 * 1024 * 1024usize
                } else {
                    (stamp.size as usize)
                        .saturating_mul(4)
                        .min(15 * 1024 * 1024)
                };
                let needs_preview = !unchanged || (preview.is_none() && file_issues.is_empty());
                if focused && needs_preview && !is_subagent && cost <= preview_budget {
                    preview_budget = preview_budget.saturating_sub(cost);
                    let retry = !file_issues.is_empty();
                    file_issues.clear();
                    self.metrics.body_reads += 1;
                    let info = info.map(Ok).unwrap_or_else(|| fs::metadata(path))?;
                    match preview::read_previews(
                        path,
                        if retry {
                            None
                        } else {
                            previous.and_then(|previous| previous.preview.as_ref())
                        },
                        &info,
                    ) {
                        Ok(next) => preview = Some(next),
                        Err(_) => {
                            if appended {
                                preview = previous.and_then(|previous| previous.preview.clone());
                            }
                            file_issues.push(json!({"kind":"preview-unavailable","id":key(id),"message":"此会话的最新消息暂不可读。"}));
                        }
                    }
                }
                let mut extra = BTreeMap::new();
                let fallback_title = format!("会话 {}", id.chars().take(8).collect::<String>());
                extra.insert(
                    "createdAt".into(),
                    json!(
                        timestamp(row, "created_at")
                            .or_else(|| meta["timestamp"].as_str().map(str::to_owned))
                            .or_else(|| info_created(path))
                    ),
                );
                extra.insert(
                    "updatedAt".into(),
                    json!(timestamp(row, "updated_at").or_else(|| stamp.modified.map(iso))),
                );
                let saved_preview = self
                    .seeded
                    .get(id)
                    .map(|saved| {
                        let message = |role: &str| {
                            saved
                                .extra
                                .get("latestMessages")
                                .and_then(|v| v.get(role))
                                .and_then(Value::as_str)
                                .map(|text| preview::Message {
                                    role: role.into(),
                                    text: text.into(),
                                })
                        };
                        let latest = saved.extra.get("latestMessage").and_then(|value| {
                            Some(preview::Message {
                                role: value["role"].as_str()?.into(),
                                text: value["text"].as_str()?.into(),
                            })
                        });
                        Previews {
                            latest,
                            user: message("user"),
                            assistant: message("assistant"),
                        }
                    })
                    .unwrap_or_default();
                let previews = preview
                    .as_ref()
                    .map(|state| &state.previews)
                    .unwrap_or(&saved_preview);
                extra.insert("latestMessage".into(), json!(previews.latest));
                extra.insert("latestMessages".into(),json!({"user":previews.user.as_ref().map(|message|&message.text),"assistant":previews.assistant.as_ref().map(|message|&message.text)}));
                extra.insert("previewVersion".into(), json!(2));
                let statuses: Vec<_> = [previews.user.is_some(), previews.assistant.is_some()]
                    .iter()
                    .enumerate()
                    .map(|(index, present)| {
                        if !file_issues.is_empty() {
                            "unavailable"
                        } else if *present {
                            "available"
                        } else if preview.as_ref().is_some_and(|state| state.limited[index]) {
                            "limited"
                        } else {
                            "empty"
                        }
                    })
                    .collect();
                extra.insert(
                    "previewStatus".into(),
                    json!({"user":statuses[0],"assistant":statuses[1]}),
                );
                extra.insert("openUrl".into(), json!(format!("codex://threads/{id}")));
                let record = Node {
                    id: key(id),
                    agent: "codex".into(),
                    native_id: Some(id.into()),
                    parent_id: valid_id(parent).then(|| key(parent)),
                    relation: if !forked.is_empty() {
                        Some("fork".into())
                    } else if !spawned.is_empty() {
                        Some("spawn".into())
                    } else {
                        None
                    },
                    title: clip(first(&[
                        text(row, "name"),
                        text(name, "thread_name"),
                        text(row, "title"),
                        text(&meta, "agent_nickname"),
                        &fallback_title,
                    ])),
                    workspace: first(&[text(row, "cwd"), text(&meta, "cwd")]).into(),
                    archived: if row.is_null() {
                        *archived
                    } else {
                        truthy(&row["archived"])
                    },
                    subagent: is_subagent,
                    extra,
                    ..Node::default()
                };
                Ok(Cached {
                    stamp,
                    meta,
                    preview,
                    record,
                    issues: file_issues,
                })
            })();
            match result {
                Ok(cached) => {
                    issues.extend(cached.issues.clone());
                    insert_record(&mut records, cached.record.clone());
                    seen.insert(path.clone());
                    self.cache.insert(path.clone(), cached);
                }
                Err(error) => {
                    if error
                        .downcast_ref::<std::io::Error>()
                        .is_none_or(|e| e.kind() != std::io::ErrorKind::NotFound)
                        && let Some(previous) = previous
                    {
                        insert_record(&mut records, previous.record.clone());
                        seen.insert(path.clone());
                    }
                    issues.push(json!({"kind":"rollout-unavailable","file":path.file_name().map(|name|name.to_string_lossy()),"message":error.to_string()}));
                }
            }
        }
        self.preview_budget = preview_budget;
        self.cache.retain(|path, _| seen.contains(path));
        if let Some(ids) = self.focused.clone() {
            self.observe(&ids.into_iter().collect::<Vec<_>>());
        }
        for (id, row) in rows {
            if records.contains_key(&key(&id)) {
                continue;
            }
            let fallback = format!("会话 {}", id.chars().take(8).collect::<String>());
            let name = self.names.get(&id).unwrap_or(&Value::Null);
            let mut extra = BTreeMap::new();
            for (field, value) in [
                ("latestMessage", Value::Null),
                ("latestMessages", json!({"user":null,"assistant":null})),
                ("previewVersion", json!(2)),
                (
                    "previewStatus",
                    json!({"user":"unavailable","assistant":"unavailable"}),
                ),
                ("createdAt", json!(timestamp(&row, "created_at"))),
                ("updatedAt", json!(timestamp(&row, "updated_at"))),
                ("openUrl", json!(format!("codex://threads/{id}"))),
                ("ancestryUnknown", json!(true)),
            ] {
                extra.insert(field.into(), value);
            }
            let record = Node {
                id: key(&id),
                agent: "codex".into(),
                native_id: Some(id.clone()),
                title: clip(first(&[
                    text(&row, "name"),
                    text(name, "thread_name"),
                    text(&row, "title"),
                    &fallback,
                ])),
                workspace: text(&row, "cwd").into(),
                archived: truthy(&row["archived"]),
                subagent: subagent(&row["source"]),
                extra,
                ..Node::default()
            };
            issues.push(json!({"kind":"ancestry-unavailable","id":record.id}));
            records.insert(record.id.clone(), record);
        }
        self.files = files;
        self.initialized = true;
        Ok((records.into_values().collect(), issues))
    }
}
fn info_created(path: &Path) -> Option<String> {
    fs::metadata(path).ok()?.created().ok().map(iso)
}
fn truthy(value: &Value) -> bool {
    !value.is_null() && value != false && value != 0 && value != ""
}
fn insert_record(records: &mut BTreeMap<String, Node>, record: Node) {
    if records.get(&record.id).is_none_or(|previous| {
        record.extra["updatedAt"].as_str() > previous.extra["updatedAt"].as_str()
    }) {
        records.insert(record.id.clone(), record);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn first_reply_reads_only_the_hovered_session_and_reuses_it_after_append() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("profile");
        fs::create_dir_all(home.join("sessions")).unwrap();
        let id = "00000000-0000-4000-8000-000000000001";
        let path = home.join("sessions/rollout-fixture.jsonl");
        fs::write(&path, json!({"type":"session_meta","payload":{"id":id}}).to_string()+"\n"+
            &json!({"type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}).to_string()+"\n").unwrap();
        let db = Connection::open(home.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT,rollout_path TEXT,title TEXT);")
            .unwrap();
        db.execute(
            "INSERT INTO threads VALUES (?1,?2,'fixture')",
            rusqlite::params![id, path.to_str()],
        )
        .unwrap();
        let mut adapter = CodexAdapter::new(home);
        adapter.observe(&[]);
        adapter.scan(true).unwrap();
        assert_eq!(adapter.metrics.body_reads, 0);
        let expected = preview::FirstReply::Available {
            text: "first reply".into(),
            user: None,
        };
        assert_eq!(adapter.first_reply(id), expected);
        assert_eq!(adapter.metrics.body_reads, 1);
        let mut writer = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(
            writer,
            "{}",
            json!({"type":"event_msg","payload":{"type":"agent_message","message":"newest reply"}})
        )
        .unwrap();
        writer.flush().unwrap();
        assert_eq!(adapter.first_reply(id), expected);
        assert_eq!(adapter.metrics.body_reads, 1);
        assert_eq!(
            adapter.first_reply("00000000-0000-4000-8000-000000000099"),
            preview::FirstReply::Unavailable
        );
        assert_eq!(adapter.metrics.body_reads, 1);
    }
    #[test]
    fn foreground_uses_database_versions_and_only_reads_the_selected_log() {
        let root = tempfile::tempdir().unwrap();
        let sessions = root.path().join("sessions");
        fs::create_dir(&sessions).unwrap();
        let ids = [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ];
        let paths = ids.map(|id| sessions.join(format!("rollout-{id}.jsonl")));
        for (id, path) in ids.iter().zip(&paths) {
            fs::write(path,json!({"type":"session_meta","payload":{"id":id}}).to_string()+"\n"+
                &json!({"type":"event_msg","payload":{"type":"user_message","message":"initial"}}).to_string()+"\n").unwrap();
        }
        let db = Connection::open(root.path().join("state_5.sqlite")).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT, rollout_path TEXT, title TEXT, archived INTEGER);").unwrap();
        for (id, path) in ids.iter().zip(&paths) {
            db.execute(
                "INSERT INTO threads VALUES (?1,?2,'fixture',0)",
                rusqlite::params![id, path.to_str()],
            )
            .unwrap();
        }
        let mut adapter = CodexAdapter::new(root.path().into());
        adapter.observe(&[ids[0].into()]);
        adapter.scan(true).unwrap();
        assert_eq!(adapter.metrics.directory_scans, 0);
        assert_eq!(adapter.metrics.body_reads, 1);
        let before = adapter.metrics.clone();
        let mut writer = fs::OpenOptions::new().append(true).open(&paths[0]).unwrap();
        writeln!(writer,"{}",json!({"type":"event_msg","payload":{"type":"agent_message","message":"committed update"}})).unwrap();
        writer.flush().unwrap();
        assert!(adapter.scan(false).unwrap().is_none());
        assert_eq!(adapter.metrics.body_reads, before.body_reads);
        assert_eq!(adapter.metrics.metadata_reads, before.metadata_reads);
        db.execute("UPDATE threads SET title='changed' WHERE id=?1", [ids[0]])
            .unwrap();
        let (records, _) = adapter.scan(false).unwrap().unwrap();
        assert_eq!(
            records
                .iter()
                .find(|node| node.native_id.as_deref() == Some(ids[0]))
                .unwrap()
                .extra["latestMessages"]["assistant"],
            "committed update"
        );
        assert_eq!(adapter.metrics.body_reads, before.body_reads + 1);
        assert_eq!(adapter.metrics.directory_scans, 0);
        let cached = adapter
            .cache
            .values_mut()
            .find(|cached| cached.record.native_id.as_deref() == Some(ids[0]))
            .unwrap();
        cached.preview = None;
        cached
            .issues
            .push(json!({"kind":"preview-unavailable","id":key(ids[0])}));
        let reads = adapter.metrics.body_reads;
        db.execute(
            "UPDATE threads SET title='unrelated change' WHERE id=?1",
            [ids[1]],
        )
        .unwrap();
        adapter.scan(false).unwrap();
        assert_eq!(
            adapter.metrics.body_reads, reads,
            "An unchanged failed preview must not be retried."
        );
        let before = adapter.metrics.clone();
        assert!(adapter.scan(false).unwrap().is_none());
        assert_eq!(adapter.metrics.body_reads, before.body_reads);
        assert_eq!(adapter.metrics.metadata_reads, before.metadata_reads);
    }
    #[test]
    fn warm_checks_skip_content_reads_and_append_keeps_authors() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = directory.path().join("sessions");
        fs::create_dir(&sessions).unwrap();
        let path = sessions.join("rollout-fixture.jsonl");
        let id = "00000000-0000-4000-8000-000000000001";
        let message = |role: &str, text: &str| {
            json!({"type":"event_msg","payload":{"type":role,"message":text}}).to_string() + "\n"
        };
        fs::write(
            &path,
            json!({"type":"session_meta","payload":{"id":id,"timestamp":"2026-10-25T00:00:00Z"}})
                .to_string()
                + "\n"
                + &message("user_message", "保留问题")
                + &message("agent_message", "旧回答"),
        )
        .unwrap();
        let mut adapter = CodexAdapter::new(directory.path().into());
        adapter.scan(false).unwrap();
        adapter.observe(&[id.to_owned()]);
        let metrics = adapter.metrics.clone();
        // Filesystem hints may be duplicated; unchanged files must not be reread.
        adapter.scan(false).unwrap();
        assert_eq!(adapter.metrics.metadata_reads, metrics.metadata_reads);
        assert_eq!(adapter.metrics.body_reads, metrics.body_reads);
        let cache_path = adapter.home.join("sessions/rollout-fixture.jsonl");
        let first = adapter
            .cache
            .get(&cache_path)
            .unwrap()
            .preview
            .clone()
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file,"{}",json!({"type":"response_item","payload":{"type":"function_call_output","output":"x".repeat(9*1024*1024)}})).unwrap();
        write!(
            file,
            "{}{{\"type\":\"event_msg\"",
            message("agent_message", "新回答")
        )
        .unwrap();
        file.flush().unwrap();
        let next =
            preview::read_previews(&path, Some(&first), &fs::metadata(&path).unwrap()).unwrap();
        assert_eq!(next.previews.user.as_ref().unwrap().text, "保留问题");
        assert_eq!(next.previews.assistant.as_ref().unwrap().text, "新回答");
        writeln!(
            file,
            ",\"payload\":{{\"type\":\"user_message\",\"message\":\"完整问题\"}}}}"
        )
        .unwrap();
        file.flush().unwrap();
        let completed =
            preview::read_previews(&path, Some(&next), &fs::metadata(&path).unwrap()).unwrap();
        assert_eq!(completed.previews.user.unwrap().text, "完整问题");
        assert!(
            adapter.scan(false).unwrap().is_none(),
            "Legacy profiles must not poll the filesystem."
        );
        let (records, _) = adapter.scan(true).unwrap().unwrap();
        assert_eq!(records[0].extra["latestMessages"]["user"], "完整问题");
        drop(file);
        let replacement = sessions.join("replacement.tmp");
        let new_id = "00000000-0000-4000-8000-000000000002";
        fs::write(
            &replacement,
            json!({"type":"session_meta","payload":{"id":new_id}}).to_string()
                + "\n"
                + &message("user_message", "新文件"),
        )
        .unwrap();
        fs::rename(&path, sessions.join("retired.log")).unwrap();
        fs::rename(replacement, &path).unwrap();
        let (records, _) = adapter.scan(true).unwrap().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].native_id.as_deref(), Some(new_id));
        assert!(records[0].extra["latestMessages"]["user"].is_null());
        adapter.observe(&[new_id.to_owned()]);
        let (records, _) = adapter.scan(false).unwrap().unwrap();
        assert_eq!(records[0].extra["latestMessages"]["user"], "新文件");
    }
}
