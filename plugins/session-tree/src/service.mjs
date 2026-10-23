import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createIndex } from './core/tree.mjs';
import { readIndex, writeJson } from './core/store.mjs';

export class TreeService {
  constructor({ adapter, dataDir }) {
    this.adapter = adapter;
    this.dataDir = dataDir;
    this.indexPath = join(dataDir, 'session-tree.index.json');
  }
  async refresh({ force = true } = {}) {
    if (!this.pending) {
      this.pending = (async () => {
        const { records, issues, unchanged } = await this.adapter.scan({ force });
        if (unchanged && this.snapshot) return this.snapshot;
        const index = createIndex(records, { issues });
        const signature = createHash('sha256').update(JSON.stringify({
          nodes: index.nodes.map(({ updatedAt, ...node }) => node), issues: index.issues,
        })).digest('hex');
        if (signature === this.signature && this.snapshot) return this.snapshot;
        await writeJson(this.indexPath, index);
        this.signature = signature;
        this.snapshot = index;
        return index;
      })().finally(() => { this.pending = null; });
    }
    return this.pending;
  }
  async read() { return this.snapshot ??= await readIndex(this.indexPath); }
  close() { this.adapter.close?.(); }
}

export function summary(index) {
  return {
    sessions: index.nodes.filter(node => !node.missing).length,
    forks: index.nodes.filter(node => node.relation === 'fork').length,
    roots: index.nodes.filter(node => !node.parentId).length,
    issues: index.issues.length, generatedAt: index.generatedAt,
  };
}
