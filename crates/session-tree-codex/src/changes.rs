//! Request-driven database checks. No watchers, event queues, threads or timers.
use anyhow::Result;
use rusqlite::{Connection, OpenFlags};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
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
    pub database: bool,
    pub state_path: Option<PathBuf>,
}
pub struct ChangeTracker {
    home: PathBuf,
    db: Option<(PathBuf, Connection, i64)>,
    initialized: bool,
    pending: Changes,
    focused: BTreeMap<String, PathBuf>,
}
impl ChangeTracker {
    pub fn new(home: &Path) -> Self {
        Self {
            home: home.into(),
            db: None,
            initialized: false,
            pending: Changes::default(),
            focused: BTreeMap::new(),
        }
    }
    fn open_database(&mut self, reopen: bool) -> Result<()> {
        let latest = fs::read_dir(&self.home)?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name().to_str()?.to_owned();
                Some((
                    name.strip_prefix("state_")?
                        .strip_suffix(".sqlite")?
                        .parse::<u64>()
                        .ok()?,
                    entry.path(),
                ))
            })
            .max_by_key(|entry| entry.0)
            .map(|entry| entry.1);
        if !reopen && latest.as_ref() == self.db.as_ref().map(|entry| &entry.0) {
            return Ok(());
        }
        self.db = if let Some(path) = latest {
            let connection = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            connection.busy_timeout(Duration::from_millis(200))?;
            let version = connection.query_row("PRAGMA data_version", [], |row| row.get(0))?;
            Some((path, connection, version))
        } else {
            None
        };
        self.pending.state = true;
        Ok(())
    }
    pub fn focus(&mut self, paths: BTreeMap<String, PathBuf>, changed: bool) {
        self.focused = paths;
        if changed {
            self.pending.paths.extend(self.focused.clone());
        }
    }
    pub fn retry(&mut self) {
        self.initialized = false;
    }
    pub fn take(&mut self, opening: bool) -> Result<Option<Changes>> {
        let first = !self.initialized;
        if first || opening {
            self.open_database(opening)?;
        }
        let mut database_changed = false;
        if let Some((_, connection, before)) = &mut self.db {
            let current =
                connection.query_row("PRAGMA data_version", [], |row| row.get::<_, i64>(0))?;
            database_changed = current != *before;
            *before = current;
        }
        if first || opening || database_changed {
            self.pending.state = true;
            self.pending.names = first || opening;
            self.pending.database = self.db.is_some();
            self.pending.discover = self.db.is_none();
            self.pending.full = first && self.db.is_none();
            self.pending.paths.extend(self.focused.clone());
        }
        self.initialized = true;
        let pending = &self.pending;
        if !pending.state && !pending.names && !pending.discover && pending.paths.is_empty() {
            return Ok(None);
        }
        self.pending.database = self.db.is_some();
        self.pending.state_path = self.db.as_ref().map(|entry| entry.0.clone());
        Ok(Some(std::mem::take(&mut self.pending)))
    }
}
