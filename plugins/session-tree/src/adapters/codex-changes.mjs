import { watch } from 'node:fs';
import { join, resolve } from 'node:path';

export const pathKey = path => process.platform === 'win32' ? resolve(path).replace(/^\\\\\?\\/, '').toLowerCase() : resolve(path);
const blank = () => ({ paths: new Set(), names: false, state: false, discover: false, full: false });

/** Events only invalidate caches. No file content is read from a watch callback. */
export class CodexChanges {
  constructor(home, { reconcileMs = 120000 } = {}) {
    this.home = home;
    this.reconcileMs = reconcileMs;
    this.nextCheck = 0;
    this.pending = blank();
    this.watchers = new Map();
  }
  start() {
    this.add(this.home, false);
    this.add(join(this.home, 'sessions'), true);
    this.add(join(this.home, 'archived_sessions'), true);
  }
  add(directory, recursive) {
    if (this.watchers.has(directory)) return;
    try {
      const watcher = watch(directory, { recursive, persistent: false }, (event, filename) => {
        if (!filename) { this.pending.full = true; return; }
        const name = String(filename);
        if (!recursive) {
          if (name === 'session_index.jsonl') this.pending.names = true;
          if (/^state_\d+\.sqlite(?:-wal|-shm)?$/.test(name)) this.pending.state = true;
          if (['sessions', 'archived_sessions'].includes(name)) {
            this.pending.discover = true;
            const child = join(this.home, name);
            this.watchers.get(child)?.close(); this.watchers.delete(child); this.start();
          }
        } else this.invalidate(join(directory, name), event);
      });
      watcher.on('error', () => { watcher.close(); this.watchers.delete(directory); this.nextCheck = 0; });
      this.watchers.set(directory, watcher);
    } catch { /* Missing directories and unavailable watchers use reconciliation. */ }
  }
  invalidate(path, event = 'change') {
    if (/rollout-.*\.jsonl(?:\.zst)?$/.test(path)) this.pending.paths.add(pathKey(path));
    if (event === 'rename') this.pending.discover = true;
  }
  take(force = false) {
    if (!force) this.start();
    if (force || Date.now() >= this.nextCheck || this.pending.full) {
      Object.assign(this.pending, { full: true, names: true, state: true, discover: true });
      // An unavailable watcher gets a bounded metadata fallback.
      this.nextCheck = Date.now() + (this.watchers.size >= 2 ? this.reconcileMs : 15000);
    }
    const change = this.pending;
    if (!change.full && !change.paths.size && !change.names && !change.state && !change.discover) return null;
    this.pending = blank();
    return change;
  }
  close() { for (const watcher of this.watchers.values()) watcher.close(); this.watchers.clear(); }
}
