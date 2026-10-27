const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { join, resolve, relative } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CodexProvider } = require('../out/agents/codex');

test('the bundled Rust reader returns fork metadata and notices SQLite commits without resuming a conversation', async t => {
  const parent = resolve(__dirname, '../../../.session-tree');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'vscode-test-'));
  const home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(join(home, 'sessions'), { recursive: true });
  const ids = [1, 2, 3, 4].map(n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'));
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT,rollout_path TEXT,title TEXT,cwd TEXT,source TEXT,archived INTEGER,created_at INTEGER,updated_at INTEGER)');
  const insert = db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)');
  async function add(index, parentId, source = 'vscode', archived = 0) {
    const path = join(home, 'sessions', 'rollout-' + ids[index] + '.jsonl');
    await writeFile(path, JSON.stringify({ type: 'session_meta', payload: {
      id: ids[index], cwd: workspace, ...(parentId ? { forked_from_id: parentId } : {}), source,
    } }) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'SYNTHETIC_BODY_NOT_NEEDED_FOR_EXPLORER' } }) + '\n');
    insert.run(ids[index], path, 'fixture-' + index, workspace, source, archived, 1000 + index, 2000 + index);
  }
  await add(0); await add(1, ids[0], 'vscode', 1); await add(2, ids[0], JSON.stringify({ subagent: { thread_spawn: {} } }));
  const provider = new CodexProvider({ binary: join(__dirname, '../bin/session-tree' + (process.platform === 'win32' ? '.exe' : '')),
    home, data: join(directory, 'index') });
  t.after(async () => {
    provider.dispose(); db.close();
    const child = relative(parent, directory);
    assert.ok(child && !child.startsWith('..') && !child.includes('/'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const first = await provider.read(true);
  assert.equal(first.nodes.length, 2);
  assert.equal(first.nodes.find(node => node.nativeId === ids[1]).parentId, 'codex:' + ids[0]);
  assert.equal(first.nodes.find(node => node.nativeId === ids[1]).archived, true);
  assert.equal(first.nodes.find(node => node.nativeId === ids[0]).updatedAt, new Date(2000 * 1000).toISOString());
  assert.equal((await provider.read(false, first.revision)).nodes, undefined);
  await add(3, ids[1]);
  const changed = await provider.read(false, first.revision);
  assert.equal(changed.nodes.length, 3);
  assert.equal(changed.nodes.find(node => node.nativeId === ids[3]).parentId, 'codex:' + ids[1]);
  // A reply can change only updated_at, with the same title and ancestry.
  db.prepare('UPDATE threads SET updated_at=9000 WHERE id=?').run(ids[0]);
  const activity = await provider.read(false, changed.revision);
  assert.notEqual(activity.revision, changed.revision);
  assert.equal(activity.nodes.find(node => node.nativeId === ids[0]).updatedAt, new Date(9000 * 1000).toISOString());
  assert.equal((await provider.read(false, activity.revision)).nodes, undefined);
  provider.dispose();
  db.prepare('UPDATE threads SET updated_at=10000 WHERE id=?').run(ids[0]);
  const reopened = new CodexProvider({ binary: join(__dirname, '../bin/session-tree' + (process.platform === 'win32' ? '.exe' : '')),
    home, data: join(directory, 'index') });
  try {
    const restored = await reopened.read(true);
    assert.equal(restored.nodes.find(node => node.nativeId === ids[0]).updatedAt, new Date(10000 * 1000).toISOString());
  } finally { reopened.dispose(); }
  assert.ok(!(await readFile(join(directory, 'index/session-tree.index.json'), 'utf8')).includes('SYNTHETIC_BODY_NOT_NEEDED_FOR_EXPLORER'));
});
