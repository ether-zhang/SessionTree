//! FSEvents can delay writes until close. Probe metadata for visible families only.
use crate::{
    Stamp,
    changes::{Changes, path_key},
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn stamp(path: &Path) -> Option<Stamp> {
    fs::metadata(path).ok().map(|info| Stamp::new(&info, path))
}
struct Observed {
    until: Instant,
    stamp: Option<Stamp>,
    directory: bool,
}
pub struct MetadataProbe {
    home: PathBuf,
    root: Option<Stamp>,
    metadata: BTreeMap<PathBuf, (bool, Option<Stamp>)>,
    observed: BTreeMap<PathBuf, Observed>,
}
impl MetadataProbe {
    pub fn new(home: &Path) -> Self {
        Self {
            home: home.into(),
            root: None,
            metadata: BTreeMap::new(),
            observed: BTreeMap::new(),
        }
    }
    pub fn observe(&mut self, files: impl IntoIterator<Item = (PathBuf, Stamp)>) {
        let until = Instant::now() + Duration::from_secs(120);
        for (path, cached) in files {
            if let Some(parent) = path.parent() {
                let parent = parent.to_path_buf();
                self.observed
                    .entry(parent.clone())
                    .or_insert_with(|| Observed {
                        until,
                        stamp: stamp(&parent),
                        directory: true,
                    })
                    .until = until;
            }
            // Seed from the adapter snapshot, so a write between scan and observe is not lost.
            self.observed.insert(
                path,
                Observed {
                    until,
                    stamp: Some(cached),
                    directory: false,
                },
            );
        }
    }
    pub fn take(&mut self, changes: &mut Changes) {
        let root = stamp(&self.home);
        if root != self.root {
            self.root = root;
            changes.names = true;
            changes.state = true;
            changes.discover = true;
            let mut paths = vec![(self.home.join("session_index.jsonl"), false)];
            if let Ok(entries) = fs::read_dir(&self.home) {
                let latest = entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| {
                        let name = entry.file_name().to_str()?.to_owned();
                        let number = name
                            .strip_prefix("state_")?
                            .strip_suffix(".sqlite")?
                            .parse::<u64>()
                            .ok()?;
                        Some((number, entry.path()))
                    })
                    .max_by_key(|entry| entry.0);
                if let Some((_, path)) = latest {
                    let mut wal = path.as_os_str().to_os_string();
                    wal.push("-wal");
                    paths.extend([(path, true), (PathBuf::from(wal), true)]);
                }
            }
            let previous = std::mem::take(&mut self.metadata);
            for (path, state) in paths {
                let before = previous.get(&path).and_then(|(_, stamp)| stamp.clone());
                self.metadata.insert(path, (state, before));
            }
        }
        for (path, (state, before)) in &mut self.metadata {
            let current = stamp(path);
            if current != *before {
                if *state {
                    changes.state = true;
                } else {
                    changes.names = true;
                }
                *before = current;
            }
        }
        let now = Instant::now();
        self.observed.retain(|_, entry| entry.until > now);
        for (path, entry) in &mut self.observed {
            let current = stamp(path);
            if current != entry.stamp {
                if entry.directory {
                    changes.discover = true;
                } else {
                    changes.paths.insert(path_key(path), path.clone());
                }
                entry.stamp = current;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn metadata_fallback_detects_an_open_writer_and_stays_idle_when_unchanged() {
        let home = tempfile::tempdir().unwrap();
        let sessions = home.path().join("sessions");
        fs::create_dir(&sessions).unwrap();
        let path = sessions.join("rollout-open.jsonl");
        fs::write(&path, "old\n").unwrap();
        let mut probe = MetadataProbe::new(home.path());
        probe.take(&mut Changes::default());
        probe.observe([(path.clone(), stamp(&path).unwrap())]);
        let mut idle = Changes::default();
        probe.take(&mut idle);
        assert!(idle.paths.is_empty() && !idle.names && !idle.state && !idle.discover);
        let mut writer = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(writer, "new").unwrap();
        writer.flush().unwrap();
        let mut changed = Changes::default();
        probe.take(&mut changed);
        assert!(changed.paths.contains_key(&path_key(&path)));
        let mut idle = Changes::default();
        probe.take(&mut idle);
        assert!(idle.paths.is_empty() && !idle.names && !idle.state && !idle.discover);
        fs::write(home.path().join("state_5.sqlite-wal"), "wal").unwrap();
        fs::write(home.path().join("state_5.sqlite"), "db").unwrap();
        let mut changed = Changes::default();
        probe.take(&mut changed);
        assert!(changed.state);
        let mut wal = fs::OpenOptions::new()
            .append(true)
            .open(home.path().join("state_5.sqlite-wal"))
            .unwrap();
        writeln!(wal, "commit").unwrap();
        wal.flush().unwrap();
        let mut changed = Changes::default();
        probe.take(&mut changed);
        assert!(changed.state);
    }
}
