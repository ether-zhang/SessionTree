import { SessionNode } from './types';

function activityTime(node: SessionNode): number {
  return Date.parse(node.updatedAt ?? '') || Date.parse(node.createdAt ?? '') || 0;
}

function normalize(value: string): string {
  const path = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' || /^[a-z]:\//i.test(path) ? path.toLowerCase() : path;
}

export function inWorkspace(path: string, folders: readonly string[]): boolean {
  if (!path) return false;
  const candidate = normalize(path);
  return folders.some(folder => {
    const root = normalize(folder);
    return candidate === root || candidate.startsWith(root + '/');
  });
}

export class SessionForest {
  readonly nodes = new Map<string, SessionNode>();
  readonly parents = new Map<string, string>();
  readonly children = new Map<string, SessionNode[]>();
  readonly roots: SessionNode[] = [];

  static forSession(records: readonly SessionNode[], sessionId?: string): SessionForest {
    return new SessionForest(records, [], false, sessionId ?? '');
  }

  constructor(records: readonly SessionNode[], folders: readonly string[], workspaceOnly: boolean, readonly selectedId?: string) {
    const candidates = new Map(records.filter(node => !node.subagent).map(node => [node.id, node]));
    const parents = new Map<string, string>();
    for (const node of candidates.values()) {
      if (node.parentId && node.parentId !== node.id && candidates.has(node.parentId)) parents.set(node.id, node.parentId);
    }
    // A future adapter must not be able to give the native tree a cyclic hierarchy.
    const rootFor = new Map<string, string>();
    const rootOf = (id: string): string => {
      const path = new Set<string>();
      let cursor = id;
      while (parents.has(cursor) && !rootFor.has(cursor)) {
        path.add(cursor);
        const parent = parents.get(cursor)!;
        if (path.has(parent)) { parents.delete(cursor); break; }
        cursor = parent;
      }
      const root = rootFor.get(cursor) ?? cursor;
      rootFor.set(cursor, root);
      for (const member of path) rootFor.set(member, root);
      return root;
    };
    const includedRoots = new Set<string>();
    const selectedRoot = selectedId !== undefined && candidates.has(selectedId) ? rootOf(selectedId) : undefined;
    for (const node of candidates.values()) {
      const root = rootOf(node.id);
      if (selectedId !== undefined ? root === selectedRoot : !workspaceOnly || inWorkspace(node.workspace, folders)) includedRoots.add(root);
    }
    for (const node of candidates.values()) {
      if (!includedRoots.has(rootOf(node.id))) continue;
      this.nodes.set(node.id, node);
      const parent = parents.get(node.id);
      if (parent) {
        this.parents.set(node.id, parent);
        const siblings = this.children.get(parent) ?? [];
        siblings.push(node);
        this.children.set(parent, siblings);
      } else this.roots.push(node);
    }
    const activity = new Map([...this.nodes.values()].map(node => [node.id, activityTime(node)]));
    const remaining = new Map([...this.nodes.keys()].map(id => [id, this.children.get(id)?.length ?? 0]));
    const ready = [...this.nodes.keys()].filter(id => remaining.get(id) === 0);
    // The latest descendant moves its whole family/branch up, keeping the hierarchy intact.
    for (const id of ready) {
      const parent = this.parents.get(id);
      if (!parent) continue;
      activity.set(parent, Math.max(activity.get(parent)!, activity.get(id)!));
      remaining.set(parent, remaining.get(parent)! - 1);
      if (remaining.get(parent) === 0) ready.push(parent);
    }
    const compare = (a: SessionNode, b: SessionNode) => activity.get(b.id)! - activity.get(a.id)!
      || activityTime(b) - activityTime(a) || a.id.localeCompare(b.id);
    this.roots.sort(compare);
    for (const children of this.children.values()) children.sort(compare);
  }
}

/** Sidebar navigation: the initial conversation list leads into one complete family. */
export class SessionBrowser {
  private records: readonly SessionNode[] = [];
  sessions: SessionNode[] = [];
  forest = SessionForest.forSession([]);
  selectedId?: string;

  get inTree(): boolean { return this.selectedId !== undefined; }

  replace(records: readonly SessionNode[]): void {
    this.records = records;
    this.sessions = records.filter(node => !node.missing && !node.subagent && Boolean(node.nativeId))
      .sort((a, b) => activityTime(b) - activityTime(a) || a.id.localeCompare(b.id));
    this.forest = SessionForest.forSession(records, this.selectedId);
  }

  openTree(sessionId: string): boolean {
    const node = this.sessions.find(node => node.id === sessionId);
    if (!node || node.archived) return false;
    this.selectedId = sessionId;
    this.forest = SessionForest.forSession(this.records, sessionId);
    return true;
  }

  backToList(): void {
    this.selectedId = undefined;
    this.forest = SessionForest.forSession([]);
  }

  children(node?: SessionNode): SessionNode[] {
    if (!this.inTree) return node ? [] : this.sessions;
    return node ? this.forest.children.get(node.id) ?? [] : this.forest.roots;
  }

  getNode(id: string): SessionNode | undefined {
    return this.inTree ? this.forest.nodes.get(id) : this.sessions.find(node => node.id === id);
  }
}
