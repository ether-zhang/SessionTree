use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

pub fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        value
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    } else {
        value.into_owned()
    }
}
#[derive(Default)]
pub struct Changes {
    pub paths: BTreeMap<String, PathBuf>,
    pub full: bool,
    pub names: bool,
    pub state: bool,
    pub discover: bool,
}
pub struct ChangeTracker {
    home: PathBuf,
    watcher: Option<RecommendedWatcher>,
    events: Receiver<notify::Result<Event>>,
    watched: BTreeSet<PathBuf>,
    next_check: Instant,
    pending: Changes,
}
impl ChangeTracker {
    pub fn new(home: &Path) -> Self {
        let (sender, events) = mpsc::channel();
        let watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .ok();
        Self {
            home: home.into(),
            watcher,
            events,
            watched: BTreeSet::new(),
            next_check: Instant::now(),
            pending: Changes::default(),
        }
    }
    fn start(&mut self) {
        if let Some(watcher) = &mut self.watcher {
            for (path, mode) in [
                (self.home.clone(), RecursiveMode::NonRecursive),
                (self.home.join("sessions"), RecursiveMode::Recursive),
                (
                    self.home.join("archived_sessions"),
                    RecursiveMode::Recursive,
                ),
            ] {
                if !self.watched.contains(&path) && watcher.watch(&path, mode).is_ok() {
                    self.watched.insert(path);
                }
            }
        }
    }
    pub fn retry(&mut self) {
        self.pending.full = true;
    }
    pub fn take(&mut self, force: bool) -> Option<Changes> {
        if !force {
            self.start();
        }
        while let Ok(event) = self.events.try_recv() {
            let Ok(event) = event else {
                self.pending.full = true;
                continue;
            };
            if matches!(event.kind, EventKind::Access(_)) {
                continue;
            }
            for path in event.paths {
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                if path.parent() == Some(self.home.as_path()) {
                    self.pending.names |= name == "session_index.jsonl";
                    self.pending.state |= name.starts_with("state_") && name.contains(".sqlite");
                    if ["sessions", "archived_sessions"].contains(&name) {
                        self.pending.discover = true;
                        if let Some(watcher) = &mut self.watcher {
                            let _ = watcher.unwatch(&path);
                        }
                        self.watched.remove(&path);
                    }
                } else if path.starts_with(self.home.join("sessions"))
                    || path.starts_with(self.home.join("archived_sessions"))
                {
                    if super::rollout_name(&path) {
                        self.pending.paths.insert(path_key(&path), path);
                    }
                    if matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(notify::event::ModifyKind::Name(_))
                    ) {
                        self.pending.discover = true;
                    }
                }
            }
        }
        if force || Instant::now() >= self.next_check || self.pending.full {
            self.pending.full = true;
            self.pending.names = true;
            self.pending.state = true;
            self.pending.discover = true;
            self.next_check = Instant::now()
                + Duration::from_secs(if self.watched.len() >= 2 { 120 } else { 15 });
        }
        let pending = &self.pending;
        if !pending.full
            && !pending.names
            && !pending.state
            && !pending.discover
            && pending.paths.is_empty()
        {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
}
