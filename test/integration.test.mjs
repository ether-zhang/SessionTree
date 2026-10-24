import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { Script } from 'node:vm';
import { APP_URI, PANEL_URI, BUTTON_URI } from '../plugins/session-tree/src/ui/codex/resource.mjs';
import { fixture, ids, rollout } from './helpers.mjs';

async function exchange(t, calls, { home, dataDir, cwd, locale } = {}) {
  const args = [fileURLToPath(new URL('../plugins/session-tree/src/ui/codex/mcp.mjs', import.meta.url))];
  if (home) args.push('--codex-home', home);
  if (dataDir) args.push('--data-dir', dataDir);
  const native = process.env.SESSION_TREE_TEST_BACKEND;
  const child = spawn(native || process.execPath, native ? args.slice(1) : args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const initialize = { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'entry-regression', version: '1' },
    ...(locale ? { _meta: { 'openai/locale': locale } } : {}) } };
  child.stdin.end([initialize, ...calls].map((call, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...call })).join('\n') + '\n');
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  return stdout.trim().split('\n').map(line => JSON.parse(line));
}

test('saved UI resource addresses survive upgrades', { timeout: 5000 }, async t => {
  const addresses = [PANEL_URI, APP_URI, 'ui://session-tree/v0.4.1/panel.html',
    'ui://session-tree/v0.4.2/panel.html', 'ui://session-tree/v0.4.3/app.html'];
  const messages = await exchange(t, [
    { method: 'resources/list' },
    ...addresses.map(uri => ({ method: 'resources/read', params: { uri } })),
    { method: 'resources/read', params: { uri: 'ui://session-tree/v0.4.1/unknown.html' } },
  ]);
  assert.deepEqual(messages[1].result.resources.map(resource => resource.uri), ['ui://session-tree/panel.html', 'ui://session-tree/conversation-button.html']);
  const canonical = messages[2].result.contents[0];
  for (let i = 0; i < addresses.length; i++) {
    assert.deepEqual(messages[i + 2].result.contents[0], { ...canonical, uri: addresses[i] });
  }
  assert.equal(messages.at(-1).error.code, -32602);
  assert.doesNotThrow(() => new Script(canonical.text.match(/<script type="module">([\s\S]*)<\/script>/)[1]));
});

test('native conversation button is isolated from the file viewer and resolves its own host', { timeout: 5000 }, async t => {
  const { home, directory } = await fixture(t), dataDir = join(directory, 'plugin data');
  await rollout(home, ids[0]);
  await rollout(home, ids[1], { forked_from_id: ids[0] });
  await rollout(home, ids[2]);
  const tool = (name, threadId, args = {}) => ({ method: 'tools/call', params: { name, arguments: args, ...(threadId ? { _meta: { threadId } } : {}) } });
  const sharedFile = { file: { name: '会话树.sessiontree', resourceUri: 'project-file:shared-conversation-entry' } };
  const messages = await exchange(t, [
    { method: 'tools/list' },
    tool('open_session_tree_panel', ids[0]), tool('open_session_tree_panel', ids[2]),
    tool('open_session_tree_file', ids[0], sharedFile), tool('open_session_tree_file', ids[2], sharedFile),
    tool('session_tree_panel_data', ids[2], { current_thread_id: ids[0] }),
    tool('open_session_tree', ids[0]),
    tool('open_session_tree_button', ids[0]), tool('open_session_tree_button', ids[2]),
    { method: 'resources/read', params: { uri: BUTTON_URI } },
  ], { home, dataDir, cwd: home });
  const tools = messages[1].result.tools;
  assert.equal(tools.some(tool => tool.name === 'open_session_tree' || tool.name === 'session_tree_data'), false);
  assert.equal(tools.some(tool => tool._meta?.['openai/ui']?.entrypoints?.some(entry => entry.type === 'global')), false);
  const opener = tools.find(tool => tool.name === 'open_session_tree_panel');
  assert.deepEqual(opener._meta.ui.visibility, ['model', 'app']);
  assert.equal(opener._meta['openai/ui'].preferredModelDisplayMode, 'fullscreen');
  assert.equal(opener._meta['openai/ui'].entrypoints, undefined);
  const button = tools.find(tool => tool.name === 'open_session_tree_button');
  const fileViewer = tools.find(tool => tool.name === 'open_session_tree_file');
  assert.deepEqual(button._meta.ui.visibility, ['app']);
  assert.deepEqual(button._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
  assert.equal(button._meta.ui.resourceUri, BUTTON_URI);
  assert.notEqual(button._meta.ui.resourceUri, fileViewer._meta.ui.resourceUri);
  const first = messages[2].result, other = messages[3].result;
  assert.deepEqual(first._meta.sessionTreePanel.index.nodes.map(node => node.nativeId).sort(), [ids[0], ids[1]]);
  assert.deepEqual(other._meta.sessionTreePanel.index.nodes.map(node => node.nativeId), [ids[2]]);
  const entry = first.structuredContent.entry;
  assert.equal(entry.path, join(dataDir, '会话树.sessiontree'));
  assert.equal(entry.markdown, `[会话树](<${entry.path.replaceAll('\\', '/')}>)`);
  assert.deepEqual(other.structuredContent.entry, entry);
  assert.ok(first.content[0].text.includes(entry.markdown));
  assert.deepEqual(JSON.parse(await readFile(entry.path, 'utf8')), { format: 'session-tree-shortcut', version: 1, view: 'current-conversation' });
  for (const [i, id] of [[2, ids[0]], [3, ids[2]], [4, ids[0]], [5, ids[2]]]) {
    assert.equal(messages[i].result.structuredContent.currentThreadId, id);
    assert.equal(messages[i].result._meta.sessionTreePanel.index.currentId, `codex:${id}`);
  }
  assert.equal(messages[6].result.isError, true);
  assert.equal(messages[7].result.isError, true);
  assert.equal(messages[8].result.structuredContent.currentThreadId, ids[0]);
  assert.equal(messages[9].result.structuredContent.currentThreadId, ids[2]);
  assert.equal(messages[10].result.contents[0].uri, BUTTON_URI);
});

test('unchanged panel responses omit the tree and revisions are scoped to the host', async t => {
  const { home, dataDir } = await fixture(t);
  await rollout(home, ids[0]); await rollout(home, ids[1]);
  const call = (threadId, args = {}) => ({ method: 'tools/call', params: {
    name: 'session_tree_panel_data', arguments: args, _meta: { threadId },
  } });
  const initial = await exchange(t, [call(ids[0])], { home, dataDir });
  const revision = initial[1].result._meta.sessionTreePanel.revision;
  const replies = await exchange(t, [call(ids[0], { since_revision: revision }), call(ids[1], { since_revision: revision })], { home, dataDir });
  assert.equal(replies[1].result._meta.sessionTreePanel, undefined);
  assert.deepEqual(replies[1].result._meta.sessionTreeUnchanged, { revision, nativeId: ids[0], mode: 'current' });
  assert.equal(replies[2].result._meta.sessionTreePanel.nativeId, ids[1]);
});

test('native entry titles and panel locale follow the locale supplied by the host', async t => {
  const { home, dataDir } = await fixture(t);
  await rollout(home, ids[0]);
  const replies = await exchange(t, [
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'open_session_tree_button', arguments: {}, _meta: { threadId: ids[0] } } },
    { method: 'tools/list', params: { _meta: { 'openai/locale': 'en-US' } } },
  ], { home, dataDir, locale: 'ja-JP' });
  assert.equal(replies[1].result.tools.find(tool => tool.name === 'open_session_tree_button').title, '会話ツリー');
  assert.equal(replies[2].result._meta.locale, 'ja-JP');
  assert.equal(replies[3].result.tools.find(tool => tool.name === 'open_session_tree_button').title, 'Session Tree');
});
