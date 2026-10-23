/** Platform-neutral records: adapters own native IDs, storage and navigation URLs. */
export function createIndex(records, { generatedAt = new Date().toISOString(), issues = [] } = {}) {
  const byId = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id || typeof record.agent !== 'string') {
      throw new TypeError('Each session needs a non-empty id and an agent.');
    }
    if (byId.has(record.id)) throw new Error(`Duplicate session: ${record.id}`);
    byId.set(record.id, {
      ...record, title: record.title || record.nativeId || record.id,
      parentId: record.parentId || null, relation: record.parentId ? (record.relation || 'fork') : null,
      archived: Boolean(record.archived), subagent: Boolean(record.subagent), missing: false,
    });
  }
  const warnings = [...issues];
  for (const node of [...byId.values()]) {
    if (node.parentId && !byId.has(node.parentId)) {
      byId.set(node.parentId, {
        id: node.parentId, agent: node.agent, nativeId: null, parentId: null, relation: null,
        title: '未找到的来源会话', workspace: '', archived: false, subagent: false, missing: true,
      });
      warnings.push({ kind: 'missing-parent', id: node.id, parentId: node.parentId });
    }
  }
  // One parent per session; break corrupted cycles deterministically, without losing nodes.
  const visited = new Set();
  for (const id of [...byId.keys()].sort()) {
    const trail = [], positions = new Map();
    let cursor = id;
    while (cursor && !visited.has(cursor)) {
      if (positions.has(cursor)) {
        const cycle = trail.slice(positions.get(cursor));
        const cut = byId.get([...cycle].sort()[0]);
        warnings.push({ kind: 'cycle', id: cut.id, parentId: cut.parentId });
        cut.parentId = null;
        cut.relation = null;
        break;
      }
      positions.set(cursor, trail.length);
      trail.push(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
    trail.forEach(key => visited.add(key));
  }
  const nodes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, generatedAt, nodes, issues: warnings };
}

/** Filters preserve ancestors so a matching fork always retains its lineage. */
export function selectTree(index, { query = '', workspace = '', archived = false, subagents = false } = {}) {
  const byId = new Map(index.nodes.map(node => [node.id, node]));
  const included = new Set(), matches = new Set();
  const needle = query.trim().toLocaleLowerCase();
  for (const node of index.nodes) {
    if (node.missing || (!archived && node.archived) || (!subagents && node.subagent)) continue;
    if (workspace && node.workspace !== workspace) continue;
    if (needle && ![node.title, node.workspace, node.nativeId, node.agent].join(' ').toLocaleLowerCase().includes(needle)) continue;
    matches.add(node.id);
    let cursor = node.id;
    while (cursor && !included.has(cursor)) {
      included.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }
  const nodes = index.nodes.filter(node => included.has(node.id)).map(node => ({ ...node, contextOnly: !matches.has(node.id) }));
  const children = new Map(nodes.map(node => [node.id, []]));
  const roots = [];
  for (const node of nodes) {
    if (children.has(node.parentId)) children.get(node.parentId).push(node);
    else roots.push(node);
  }
  const sort = (a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || a.id.localeCompare(b.id);
  roots.sort(sort);
  for (const siblings of children.values()) siblings.sort(sort);
  return { nodes, roots, children, matches };
}

export function descendants(rootId, children) {
  const result = [], pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    result.push(id);
    for (const child of [...(children.get(id) || [])].reverse()) pending.push(child.id);
  }
  return result;
}

/** Resolve the complete family of a specific node; never guess another active node. */
export function selectFamily(index, currentId) {
  const byId = new Map(index.nodes.map(node => [node.id, node]));
  let root = byId.get(currentId);
  if (!root) return { ...index, nodes: [], issues: [], rootId: null, currentId };
  const visited = new Set();
  while (root.parentId && byId.has(root.parentId)) {
    if (visited.has(root.id)) throw new Error('Cannot resolve a family from a cyclic index.');
    visited.add(root.id);
    root = byId.get(root.parentId);
  }
  const children = new Map(index.nodes.map(node => [node.id, []]));
  for (const node of index.nodes) if (children.has(node.parentId)) children.get(node.parentId).push(node);
  const ids = new Set(descendants(root.id, children));
  return {
    ...index, rootId: root.id, currentId,
    nodes: index.nodes.filter(node => ids.has(node.id)),
    issues: index.issues.filter(issue => !issue.id || ids.has(issue.id)),
  };
}
