import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_URI, PANEL_URI } from '../plugins/session-tree/src/ui/codex/resource.mjs';
import { fixture, ids, rollout } from './helpers.mjs';

test('an existing MCP connection still serves its UI after the old package directory is retired', async t => {
  const { directory, home, dataDir } = await fixture(t);
  await rollout(home, ids[0]);
  const packageRoot = join(directory, 'package'), retiredRoot = join(directory, 'retired-package');
  for (const path of [packageRoot, retiredRoot]) {
    const child = relative(resolve(directory), resolve(path));
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unsafe package fixture path.');
  }
  await cp(fileURLToPath(new URL('../plugins/session-tree/', import.meta.url)), packageRoot, { recursive: true });
  const child = spawn(process.execPath, [join(packageRoot, 'src/ui/codex/mcp.mjs'), '--codex-home', home, '--data-dir', dataDir],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  let buffer = '', stderr = '', nextId = 1;
  const pending = new Map();
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line), task = pending.get(message.id);
      if (!task) continue;
      pending.delete(message.id);
      clearTimeout(task.timer);
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}; ${stderr}`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'upgrade-regression', version: '1' } });
  assert.equal(init.serverInfo.version, '0.5.8');
  const before = await request('resources/read', { uri: PANEL_URI });
  await rename(packageRoot, retiredRoot);
  assert.deepEqual(await request('ping'), {});
  assert.deepEqual(await request('resources/read', { uri: PANEL_URI }), before);
  assert.deepEqual((await request('resources/read', { uri: APP_URI })).contents[0], { ...before.contents[0], uri: APP_URI });
  const data = await request('tools/call', { name: 'session_tree_panel_data', arguments: {}, _meta: { threadId: ids[0] } });
  assert.equal(data.isError, undefined);
  assert.equal(data._meta.sessionTreePanel.index.currentId, `codex:${ids[0]}`);
  child.stdin.end();
  const [code] = await closed;
  assert.equal(code, 0, stderr);
});
