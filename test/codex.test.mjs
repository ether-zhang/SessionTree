import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import { CodexAdapter, key, readSessionMeta } from '../plugins/session-tree/src/adapters/codex.mjs';
import { TreeService } from '../plugins/session-tree/src/service.mjs';
import { fixture, ids, meta, rollout } from './helpers.mjs';

test('canonical fork metadata wins over copied parent records and latest name wins', async t => {
  const { home } = await fixture(t);
  await rollout(home, ids[0]);
  const path = await rollout(home, ids[1], {}, { content: `${JSON.stringify(meta(ids[1], { forked_from_id: ids[0] }))}\n${JSON.stringify(meta(ids[0]))}\n` });
  await writeFile(join(home, 'session_index.jsonl'), [
    { id: ids[1], thread_name: 'old' }, { id: ids[1], thread_name: 'renamed' },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n{"partial');
  const before = await readFile(path);
  const { records, issues } = await new CodexAdapter(home).scan();
  const child = records.find(record => record.nativeId === ids[1]);
  assert.equal(child.parentId, key(ids[0]));
  assert.equal(child.title, 'renamed');
  assert.equal(child.relation, 'fork');
  assert.deepEqual(issues, []);
  assert.deepEqual(await readFile(path), before);
});

test('archived compressed sessions and spawn sources are recognized', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[1], {}, { archived: true, suffix: '.zst',
    content: zstdCompressSync(Buffer.from(`${JSON.stringify(meta(ids[1], { forked_from_id: ids[0] }))}\n`)) });
  await rollout(home, ids[2], { source: { subagent: { thread_spawn: { parent_thread_id: ids[1] } } } });
  const { records } = await new CodexAdapter(home).scan();
  assert.equal((await readSessionMeta(path)).id, ids[1]);
  assert.equal(records.find(record => record.nativeId === ids[1]).archived, true);
  assert.equal(records.find(record => record.nativeId === ids[2]).relation, 'spawn');
  assert.equal(records.find(record => record.nativeId === ids[2]).parentId, key(ids[1]));
});

test('read-only database metadata handles names and database-only sessions', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0]);
  const dbPath = join(home, 'state_5.sqlite'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, name TEXT, title TEXT, cwd TEXT, source TEXT, archived INTEGER, created_at INTEGER, updated_at INTEGER)');
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run(ids[0], path, 'current name', 'first message', 'project', 'vscode', 0, 1000, 2000);
  insert.run(ids[1], join(home, 'missing.jsonl'), null, 'without rollout', 'project', 'vscode', 1, 1000, 2000);
  db.close();
  const before = await readFile(dbPath);
  const { records, issues } = await new CodexAdapter(home).scan();
  assert.equal(records.find(record => record.nativeId === ids[0]).title, 'current name');
  assert.equal(records.find(record => record.nativeId === ids[1]).ancestryUnknown, true);
  assert.equal(records.find(record => record.nativeId === ids[1]).archived, true);
  assert.equal(records[0].updatedAt, '1970-01-01T00:33:20.000Z');
  assert.ok(issues.some(issue => issue.kind === 'ancestry-unavailable'));
  assert.deepEqual(await readFile(dbPath), before);
});

test('compressed rollouts satisfy stale database paths and long legacy titles are bounded', async t => {
  const { home } = await fixture(t);
  const compressed = await rollout(home, ids[0], {}, { suffix: '.zst',
    content: zstdCompressSync(Buffer.from(`${JSON.stringify(meta(ids[0]))}\n`)) });
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(ids[0], compressed.slice(0, -4), 'long message '.repeat(200), 0);
  db.close();
  const { records, issues } = await new CodexAdapter(home).scan();
  assert.equal(records.length, 1);
  assert.equal(records[0].title.length, 240);
  assert.deepEqual(issues, []);
});

test('bad files are isolated, refresh is repeatable, failed refresh preserves saved index', async t => {
  const { home, dataDir } = await fixture(t);
  await rollout(home, ids[0]);
  await rollout(home, ids[1], {}, { content: 'not json\n' });
  const adapter = new CodexAdapter(home), service = new TreeService({ adapter, dataDir });
  const first = await service.refresh();
  assert.equal(first.nodes.length, 1);
  assert.ok(first.issues.some(issue => issue.kind === 'rollout-unavailable'));
  await writeFile(join(home, 'session_index.jsonl'), `${JSON.stringify({ id: ids[0], thread_name: 'new name' })}\n`);
  const second = await service.refresh();
  assert.equal(second.nodes[0].title, 'new name');
  adapter.scan = async () => { throw new Error('source unavailable'); };
  await assert.rejects(service.refresh(), /source unavailable/);
  assert.deepEqual(await service.read(), second);
});

test('idle checks reuse the index without writing, while only dirty rollouts update previews', async t => {
  const { home, dataDir } = await fixture(t);
  const path = await rollout(home, ids[0]);
  const adapter = new CodexAdapter(home), service = new TreeService({ adapter, dataDir });
  t.after(() => service.close());
  const first = await service.refresh(), before = await stat(service.indexPath);
  adapter.changes.take = () => null;
  assert.equal(await service.refresh({ force: false }), first);
  assert.equal((await stat(service.indexPath)).mtimeMs, before.mtimeMs);
  await appendFile(path, JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '增量正文' } }) + '\n');
  // Normalize the path in the same way on all platforms.
  const { pathKey } = await import('../plugins/session-tree/src/adapters/codex-changes.mjs');
  adapter.changes.take = () => ({ paths: new Set([pathKey(path)]), names: false, state: false, discover: false, full: false });
  const next = await service.refresh({ force: false });
  assert.equal(next.nodes[0].latestMessages.user, '增量正文');
  const unchanged = await service.refresh({ force: false });
  assert.equal(unchanged, next);
  const branch = await rollout(home, ids[1], { forked_from_id: ids[0] });
  adapter.changes.take = () => ({ paths: new Set([pathKey(branch)]), names: false, state: false, discover: false, full: false });
  const expanded = await service.refresh({ force: false });
  assert.equal(expanded.nodes.length, 2);
  assert.equal(expanded.nodes.find(node => node.nativeId === ids[1]).parentId, key(ids[0]));
});
