import { selectFamily, selectTree } from '../../core/tree.mjs';
import { conversationIndex } from './conversation-view.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nativeThreadId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('客户端未提供有效的对话 ID。');
  return value.toLowerCase();
}

/** App Server adds _meta.threadId to direct MCP tool calls (mcp_processor.rs). */
export function panelSnapshot(index, meta, selectedThreadId) {
  index = conversationIndex(index);
  const hostId = meta?.threadId == null ? null : nativeThreadId(meta.threadId);
  const selectedId = selectedThreadId == null ? null : nativeThreadId(selectedThreadId);
  if (hostId && selectedId && hostId !== selectedId) throw new Error('当前对话已经切换，请重新载入会话树。');
  const nativeId = hostId || selectedId;
  if (selectedId && !hostId && !index.nodes.some(node => node.agent === 'codex' && node.nativeId === selectedId && !node.missing)) {
    throw new Error('所选会话不在本机索引中，请刷新后重试。');
  }
  return {
    version: 1, mode: hostId ? 'current' : selectedId ? 'selected' : 'choose',
    nativeId, index: nativeId ? selectFamily(index, `codex:${nativeId}`) : index,
  };
}

/** Search retains ancestors; explicit selection is required when host context is absent. */
export function panelChoices(index, query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return index.nodes.filter(node => node.agent === 'codex' && !node.subagent && !node.missing && UUID.test(node.nativeId || '') &&
    (!needle || [node.title, node.workspace, node.nativeId].join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || a.id.localeCompare(b.id));
}

export function panelRows(index, { query = '', collapsed = new Set() } = {}) {
  const view = selectTree(conversationIndex(index), { query, archived: true });
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

export function panelNodeUrl(node) {
  if (node?.agent !== 'codex' || node.missing || node.archived || !UUID.test(node.nativeId || '') || node.id !== `codex:${node.nativeId}`) return null;
  const url = `codex://threads/${node.nativeId}`;
  return node.openUrl === url ? url : null;
}
