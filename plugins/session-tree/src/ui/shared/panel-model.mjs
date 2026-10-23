import { selectTree } from '../../core/tree.mjs';
import { visibleConversations } from './conversation-view.mjs';

export function choosePanelNodes(index, query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return index.nodes.filter(node => !node.subagent && !node.missing && typeof node.nativeId === 'string' && node.nativeId.length > 0 &&
    (!needle || [node.title, node.workspace, node.nativeId].join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || a.id.localeCompare(b.id));
}

export function treePanelRows(index, { query = '', collapsed = new Set() } = {}) {
  const view = selectTree(visibleConversations(index), { query, archived: true });
  const pending = [...view.roots].reverse().map(node => ({ node, depth: 0 })), rows = [], seen = new Set();
  while (pending.length) {
    const row = pending.pop();
    if (seen.has(row.node.id)) continue;
    seen.add(row.node.id);
    const children = view.children.get(row.node.id) || [];
    const folded = !query.trim() && collapsed.has(row.node.id);
    rows.push({ ...row, hasChildren: children.length > 0, folded });
    if (!folded) for (const node of [...children].reverse()) pending.push({ node, depth: row.depth + 1 });
  }
  return rows;
}
