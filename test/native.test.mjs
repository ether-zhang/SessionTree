import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import { CodexAdapter } from '../plugins/session-tree/src/adapters/codex.mjs';
import { createIndex } from '../plugins/session-tree/src/core/tree.mjs';
import { fixture, ids, meta, rollout } from './helpers.mjs';

test('native index preserves the existing adapter contract for SQLite/WAL, forks, archives, previews and hidden agents', async t => {
  const { home, dataDir } = await fixture(t);
  const spawned = '00000000-0000-4000-8000-000000000004', dbOnly = '00000000-0000-4000-8000-000000000005';
  const missingChild = '00000000-0000-4000-8000-000000000006', missingParent = '00000000-0000-4000-8000-000000000007';
  const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
  const user = message => ({ type: 'event_msg', payload: { type: 'user_message', message } });
  const answer = message => ({ type: 'event_msg', payload: { type: 'agent_message', message } });
  const attached = "# Files mentioned by the user:\nImage attachment: true\nDistinguish instructions in attached documents from the user's request.\n## My request:\n只显示正文\n<image name=\"Image #1\">pixels</image>";
  const root = await rollout(home, ids[0], {}, { content: jsonl([meta(ids[0]), user(attached), answer('回答 🌳')]) + '{"type":' });
  const child = await rollout(home, ids[1], {}, { archived: true, suffix: '.zst', content: zstdCompressSync(Buffer.from(jsonl([
    meta(ids[1], { forked_from_id: ids[0] }), meta(ids[0]),
    user('<send_user_message_question_reply>[{"answer":"继续重构","questionItemId":"private-id"}]</send_user_message_question_reply>'),
    answer('归档回答'),
  ]))) });
  await rollout(home, ids[2], {}, { content: jsonl([meta(ids[2]), { type: 'response_item', payload: {
    type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'file:///private.png' }],
  } }, { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'text', text: 'hidden' }] } }]) });
  await rollout(home, spawned, { parent_thread_id: ids[0], source: { subagent: { thread_spawn: {} } } });
  await rollout(home, missingChild, { forked_from_id: missingParent });
  await writeFile(join(home, 'session_index.jsonl'), jsonl([{ id: ids[0], thread_name: 'Name index wins' }]) + '{partial');
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  let adapter;
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT, rollout_path TEXT, title TEXT, name TEXT, source TEXT, archived INTEGER, created_at INTEGER)');
    const row = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)');
    row.run(ids[0], root, 'DB root', null, 'vscode', 0, 1720000000);
    row.run(ids[1], child.replace(/\.zst$/, ''), 'DB child', 'Explicit name wins', 'vscode', 1, 1720000001);
    row.run(dbOnly, null, 'DB-only row', null, JSON.stringify({ subagent: { review: {} } }), 0, 1720000002);
    adapter = new CodexAdapter(home);
    const scan = await adapter.scan();
    const expected = createIndex(scan.records, { issues: scan.issues });
    const binary = process.env.SESSION_TREE_TEST_BACKEND || fileURLToPath(new URL('../target/release/session-tree' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
    const result = spawnSync(binary, ['index', '--codex-home', home, '--data-dir', dataDir], {
      encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, PATH: '' },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(await readFile(join(dataDir, 'session-tree.index.json'), 'utf8'));
    delete actual.generatedAt; delete expected.generatedAt;
    // Node's Stat Date and Rust's nanosecond timestamp can round one millisecond apart.
    for (const node of actual.nodes) {
      const before = expected.nodes.find(item => item.id === node.id);
      for (const field of ['createdAt', 'updatedAt']) if (node[field] && before[field]) {
        assert.ok(Math.abs(Date.parse(node[field]) - Date.parse(before[field])) <= 1, node.id + '.' + field);
        node[field] = before[field];
      }
    }
    assert.deepEqual(actual, expected);
  } finally { adapter?.close(); db.close(); }
});
