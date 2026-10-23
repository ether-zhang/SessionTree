import { choosePanelNodes, treePanelRows } from '../shared/panel-model.mjs';
import { selectFamily } from '../../core/tree.mjs';
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
  return choosePanelNodes(index, query).filter(node => node.agent === 'codex' && UUID.test(node.nativeId));
}

export const panelRows = treePanelRows;

export function panelNodeUrl(node) {
  if (node?.agent !== 'codex' || node.missing || node.archived || !UUID.test(node.nativeId || '') || node.id !== `codex:${node.nativeId}`) return null;
  const url = `codex://threads/${node.nativeId}`;
  return node.openUrl === url ? url : null;
}
