import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hostTarget } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'plugins/session-tree/plugin.json'), 'utf8'));
const target = hostTarget();
const packageRoot = join(root, 'dist', 'session-tree-' + manifest.version + '-' + target.platform, 'plugins/session-tree');
const ids = Array.from({ length: 5 }, (_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];

async function main() {
  const workRoot = join(root, '.session-tree', 'review-verification');
  await mkdir(workRoot, { recursive: true });
  const work = await mkdtemp(join(workRoot, 'synthetic-'));
  const home = join(work, 'codex'), data = join(work, 'data'), originals = new Map();
  await mkdir(home); await mkdir(data);
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)');
  async function add(i, parent, title, archived = false) {
    const directory = join(home, archived ? 'archived_sessions' : 'sessions', '2026', '10', '23');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'rollout-' + ids[i] + '.jsonl');
    const content = [
      { type: 'session_meta', payload: { id: ids[i], timestamp: '2026-10-23T00:00:00Z', cwd: join(work, 'demo'), source: 'vscode',
        ...(parent == null ? {} : { forked_from_id: ids[parent] }) } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Synthetic user message for review.' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Synthetic Codex response for review.' } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n';
    await writeFile(file, content);
    originals.set(file, sha(Buffer.from(content)));
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(ids[i], file, title, archived ? 1 : 0);
  }
  const call = (name, args = {}, threadId) => ({ method: 'tools/call', params: { name, arguments: args,
    ...(threadId ? { _meta: { threadId } } : {}) } });
  function exchange(calls) {
    const init = { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-publication-check', version: '1' } } };
    const reply = spawnSync(join(packageRoot, 'bin', target.binary), ['--codex-home', home, '--data-dir', data], {
      cwd: work, windowsHide: true, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, CODEX_HOME: home, SESSION_TREE_CODEX_HOME: home, SESSION_TREE_DATA: data, PLUGIN_DATA: data, PATH: process.platform === 'win32' ? '' : '/usr/bin:/bin' },
      input: [init, ...calls].map((item, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...item })).join('\n') + '\n',
    });
    if (reply.error) throw reply.error;
    assert.equal(reply.status, 0, reply.stderr);
    const replies = reply.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(replies.length, calls.length + 1);
    replies.forEach(item => { assert.ok(!item.error, JSON.stringify(item.error)); assert.ok(!item.result.isError, JSON.stringify(item.result.content)); });
    return replies.slice(1).map(item => item.result);
  }
  let completed = false;
  try {
    await add(0, null, 'Review root');
    await add(1, 0, 'Review branch active');
    await add(2, 0, 'Review branch archived', true);
    await add(3, null, 'Review unrelated');
    const [catalog, native, search, archived, choose, selected] = exchange([
      { method: 'tools/list' }, call('open_session_tree_button', {}, ids[1]),
      call('get_session_tree', { query: 'Review branch' }),
      call('get_session_tree', { query: 'Review branch', include_archived: true }),
      call('open_session_tree_panel'), call('session_tree_panel_data', { current_thread_id: ids[3] }),
    ]);
    for (const tool of catalog.tools) {
      for (const field of ['readOnlyHint', 'openWorldHint', 'destructiveHint']) assert.equal(typeof tool.annotations[field], 'boolean', tool.name + '.' + field);
    }
    const graph = native._meta.sessionTreePanel.index;
    assert.equal(graph.currentId, 'codex:' + ids[1]);
    assert.deepEqual(graph.nodes.map(node => node.nativeId).sort(), ids.slice(0, 3));
    assert.equal(graph.nodes.find(node => node.nativeId === ids[2]).archived, true);
    results.push({ case: 'P1', mcpBehavior: 'passed', nativeEntryAndNavigation: 'not-run' });
    assert.equal(search.structuredContent.matches, 1);
    assert.equal(search.structuredContent.sessions[0].nativeId, ids[1]);
    results.push({ case: 'P2', mcpBehavior: 'passed', modelPrompt: 'not-run' });
    assert.equal(archived.structuredContent.matches, 2);
    assert.ok(archived.structuredContent.sessions.some(node => node.nativeId === ids[2] && node.archived));
    results.push({ case: 'P3', mcpBehavior: 'passed', archivedUiNavigation: 'not-run', modelPrompt: 'not-run' });
    assert.equal(choose._meta.sessionTreePanel.mode, 'choose');
    assert.equal(choose._meta.sessionTreePanel.nativeId, null);
    assert.deepEqual(selected._meta.sessionTreePanel.index.nodes.map(node => node.nativeId), [ids[3]]);
    results.push({ case: 'P4', mcpBehavior: 'passed', nativePicker: 'not-run', modelPrompt: 'not-run' });
    await add(4, 0, 'Review fresh fork');
    const [refreshed, fresh] = exchange([call('refresh_session_tree'), call('get_session_tree', { query: 'Review fresh fork' })]);
    assert.equal(refreshed.structuredContent.sessions, 5);
    assert.equal(fresh.structuredContent.sessions[0].parentId, 'codex:' + ids[0]);
    results.push({ case: 'P5', mcpBehavior: 'passed', modelPrompt: 'not-run' });
    for (const [file, expected] of originals) assert.equal(sha(await readFile(file)), expected, 'Original conversation was modified');
    for (const id of ['N1', 'N2', 'N3']) results.push({ case: id, status: 'not-run', reason: 'Agent refusal and tool selection need the intended host; no model API was called.' });
    const report = { version: manifest.version, checkedAt: new Date().toISOString(), syntheticOnly: true,
      originalConversationsUnchanged: true, realAccountSignIn: false, modelApiCalls: 0,
      scope: 'Packaged MCP tool behavior and metadata only; not a native UI, model-prompt, or review approval result.', results };
    await writeFile(join(workRoot, 'review-checks-' + manifest.version + '.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2)); completed = true;
  } finally {
    db.close();
    const child = relative(resolve(workRoot), resolve(work));
    assert.ok(child.startsWith('synthetic-') && !child.includes('..'));
    if (completed) await rm(work, { recursive: true, force: true });
    else console.error('Failed synthetic fixture preserved at: ' + work);
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
