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
#[derive(Default, Clone, Debug, PartialEq)]
pub struct Metrics {
    pub scans: usize,
    pub metadata_reads: usize,
    pub body_reads: usize,
    pub database_reads: usize,
}
pub struct CodexAdapter {
    home: PathBuf,
    home_alias: PathBuf,
    changes: ChangeTracker,
    cache: BTreeMap<PathBuf, Cached>,
    files: BTreeMap<PathBuf, bool>,
    names: BTreeMap<String, Value>,
    state: Vec<Value>,
    names_issues: Vec<Value>,
    state_issues: Vec<Value>,
    initialized: bool,
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
fn read_state(home: &Path) -> Result<Vec<Value>> {
    let mut paths = fs::read_dir(home)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            let number = name
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((number, entry.path()))
        })
        .collect::<Vec<_>>();
    paths.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let Some((_, path)) = paths.first() else {
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
            files: BTreeMap::new(),
            names: BTreeMap::new(),
            state: vec![],
            names_issues: vec![],
            state_issues: vec![],
            initialized: false,
            metrics: Metrics::default(),
        }
    }
    pub fn scan(&mut self, force: bool) -> Result<Option<(Vec<Node>, Vec<Value>)>> {
        let Some(change) = self.changes.take(force) else {
            return Ok(None);
        };
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
            match read_state(&self.home) {
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
            discover(&self.home.join("sessions"), false, &mut files)?;
            discover(&self.home.join("archived_sessions"), true, &mut files)?;
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
            if !known.contains(&path_key(&path))
                && !known.contains(&path_key(Path::new(&compressed)))
            {
                known.insert(path_key(&path));
                files.insert(path, truthy(&row["archived"]));
            }
        }
        let mut records = BTreeMap::new();
        let mut seen = BTreeSet::new();
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
                    self.metrics.metadata_reads += 1;
                    read_meta(path)?
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
                if (!unchanged || !file_issues.is_empty()) && !is_subagent {
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
                let empty = Previews::default();
                let previews = preview
                    .as_ref()
                    .map(|state| &state.previews)
                    .unwrap_or(&empty);
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
        self.cache.retain(|path, _| seen.contains(path));
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
    fn warm_checks_read_nothing_and_append_keeps_both_authors_and_partial_records() {
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
        let metrics = adapter.metrics.clone();
        assert!(adapter.scan(false).unwrap().is_none());
        assert_eq!(adapter.metrics, metrics);
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
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Some((records, _)) = adapter.scan(false).unwrap() {
                assert_eq!(records[0].extra["latestMessages"]["user"], "完整问题");
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "File watcher did not detect the appended record."
            );
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
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
        assert_eq!(records[0].extra["latestMessages"]["user"], "新文件");
    }
}
