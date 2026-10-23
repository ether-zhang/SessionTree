import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndex, selectFamily } from '../plugins/session-tree/src/core/tree.mjs';
import { panelSnapshot, panelChoices, panelRows, panelNodeUrl } from '../plugins/session-tree/src/ui/codex/panel-model.mjs';
import { ids } from './helpers.mjs';
import { conversationIndex, messagePreviewLines } from '../plugins/session-tree/src/ui/codex/conversation-view.mjs';

const node = (nativeId, title, parentId = null) => ({ id: `codex:${nativeId}`, nativeId, agent: 'codex', title,
  parentId: parentId && `codex:${parentId}`, openUrl: `codex://threads/${nativeId}` });
const index = () => createIndex([node(ids[0], 'Root'), node(ids[1], 'Branch', ids[0]),
  { ...node(ids[2], 'Unrelated newer conversation'), updatedAt: '2099-01-01T00:00:00Z' }]);

test('conversation panel follows host metadata, excluding newer unrelated conversations', () => {
  const data = index();
  const result = panelSnapshot(data, { threadId: ids[1] });
  assert.deepEqual(result, { version: 1, mode: 'current', nativeId: ids[1], index: selectFamily(data, `codex:${ids[1]}`) });
  assert.deepEqual(panelSnapshot(data, { threadId: ids[2] }).index.nodes.map(n => n.id), [`codex:${ids[2]}`]);
  assert.throws(() => panelSnapshot(data, { threadId: ids[1] }, ids[0]), /对话已经切换/);
  assert.throws(() => panelSnapshot(data, { threadId: 'invalid' }), /有效的对话 ID/);
});

test('missing host context requires explicit selection and unknown current threads stay empty', () => {
  const data = index();
  assert.deepEqual(panelSnapshot(data), { version: 1, mode: 'choose', nativeId: null, index: data });
  assert.equal(panelSnapshot(data, undefined, ids[1]).mode, 'selected');
  const absent = '00000000-0000-4000-8000-000000000099';
  assert.deepEqual(panelSnapshot(data, { threadId: absent }).index.nodes, []);
  assert.throws(() => panelSnapshot(data, undefined, absent), /不在本机索引/);
  assert.deepEqual(panelChoices(data, 'branch').map(n => n.nativeId), [ids[1]]);
});

test('compact tree collapses branches and reveals matching descendants with their ancestry', () => {
  const data = selectFamily(index(), `codex:${ids[1]}`), collapsed = new Set([`codex:${ids[0]}`]);
  assert.deepEqual(panelRows(data, { collapsed }).map(r => [r.node.title, r.depth, r.folded]), [['Root', 0, true]]);
  assert.deepEqual(panelRows(data, { query: 'branch', collapsed }).map(r => [r.node.title, r.depth, r.folded]),
    [['Root', 0, false], ['Branch', 1, false]]);
  assert.deepEqual(panelRows(data, { query: 'absent' }), []);
});

test('node navigation accepts only an exact, available Codex conversation URL', () => {
  const item = node(ids[0], '<img src=x onerror=alert(1)>');
  assert.equal(panelNodeUrl(item), item.openUrl);
  for (const change of [{ agent: 'other' }, { missing: true }, { archived: true }, { openUrl: 'https://unrelated.example/' },
    { openUrl: 'javascript:alert(1)' }, { id: `codex:${ids[1]}` }, { nativeId: 'invalid' }]) {
    assert.equal(panelNodeUrl({ ...item, ...change }), null);
  }
});

test('subagents never appear in the tree or chooser and filtering does not invent parent links', () => {
  const data = createIndex([node(ids[0], 'Root'), { ...node(ids[1], 'Worker', ids[0]), subagent: true }, node(ids[2], 'User fork', ids[1])]);
  const visible = conversationIndex(data);
  assert.deepEqual(visible.nodes.map(n => n.nativeId), [ids[0], ids[2]]);
  assert.equal(visible.nodes.find(n => n.nativeId === ids[2]).parentId, `codex:${ids[1]}`);
  assert.ok(panelRows(data).every(row => !row.node.subagent));
  assert.deepEqual(panelChoices(data).map(n => n.nativeId).sort(), [ids[0], ids[2]]);
  assert.deepEqual(panelSnapshot(data, { threadId: ids[1] }).index.nodes, []);
  assert.throws(() => panelSnapshot(data, undefined, ids[1]), /不在本机索引/);
  assert.equal(data.nodes.length, 3);
});

test('node subtitles keep independent user and Codex lines, including old indexes and missing roles', () => {
  assert.deepEqual(messagePreviewLines({ latestMessages: { user: 'latest question', assistant: '<script>literal text</script>' } }),
    ['用户：latest question', 'Codex：<script>literal text</script>']);
  assert.deepEqual(messagePreviewLines({ latestMessage: { role: 'user', text: 'old indexed question' } }),
    ['用户：old indexed question', 'Codex：暂无可读消息']);
  assert.deepEqual(messagePreviewLines({ latestMessages: { assistant: 'answer only' } }),
    ['用户：暂无可读消息', 'Codex：answer only']);
  assert.deepEqual(messagePreviewLines({}), ['用户：暂无可读消息', 'Codex：暂无可读消息']);
  assert.deepEqual(messagePreviewLines({ missing: true }), ['用户：来源会话不可用', 'Codex：来源会话不可用']);
});
