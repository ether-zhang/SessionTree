import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
import { readLatestMessage, readMessagePreviews, readPreviewState, userBody } from '../plugins/session-tree/src/adapters/codex-preview.mjs';
import { CodexAdapter } from '../plugins/session-tree/src/adapters/codex.mjs';
import { fixture, ids, meta, rollout } from './helpers.mjs';

const message = (role, text, channel) => ({ type: 'response_item', payload: { type: 'message', role, channel, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

test('latest visible message ignores tools, reasoning and partial trailing writes, without changing the source', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { content: jsonl([
    meta(ids[0]), message('user', 'older question'), message('assistant', 'Last answer\nwith whitespace'),
    message('assistant', 'private reasoning', 'analysis'), message('developer', 'private developer instructions'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'private tool output' } },
  ]) + '{"type":"response_item","payload":' });
  const before = await readFile(path);
  assert.deepEqual(await readLatestMessage(path), { role: 'assistant', text: 'Last answer with whitespace' });
  assert.deepEqual(await readFile(path), before);
});

test('bounded tail finds recent messages after large tool output and clips Unicode by characters', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { content: jsonl([
    meta(ids[0]), message('user', 'old'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(2 * 1024 * 1024) } },
    message('user', '🌳'.repeat(200)),
  ]) });
  const result = await readLatestMessage(path);
  assert.equal(Array.from(result.text).length, 160);
  assert.equal(result.text, '🌳'.repeat(159) + '…');
});

test('compressed and legacy events supply visible text, and image messages do not expose file URLs', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { suffix: '.zst', content: zstdCompressSync(Buffer.from(jsonl([
    meta(ids[0]), { type: 'event_msg', payload: { type: 'agent_message', message: 'latest archived answer' } },
    { type: 'event_msg', payload: { type: 'agent_reasoning', text: 'reasoning' } },
  ]))) });
  assert.deepEqual(await readLatestMessage(path), { role: 'assistant', text: 'latest archived answer' });
  const image = await rollout(home, ids[1], {}, { content: jsonl([meta(ids[1]), { type: 'response_item', payload: {
    type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'file:///private-image.png' }],
  } }]) });
  assert.deepEqual(await readLatestMessage(image), { role: 'user', text: '[图片]' });
});

test('adapter refresh updates excerpts after append and recognizes serialized subagent sources', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { content: jsonl([meta(ids[0]), message('user', 'first')]) });
  await rollout(home, ids[1], { source: JSON.stringify({ subagent: { review: {} } }) });
  const adapter = new CodexAdapter(home);
  assert.deepEqual((await adapter.scan()).records.find(n => n.nativeId === ids[0]).latestMessage, { role: 'user', text: 'first' });
  await appendFile(path, jsonl([message('assistant', 'next answer')]));
  const next = await adapter.scan();
  assert.deepEqual(next.records.find(n => n.nativeId === ids[0]).latestMessage, { role: 'assistant', text: 'next answer' });
  assert.deepEqual(next.records.find(n => n.nativeId === ids[0]).latestMessages, { user: 'first', assistant: 'next answer' });
  assert.deepEqual((await adapter.scan()).records.find(n => n.nativeId === ids[0]).latestMessages, { user: 'first', assistant: 'next answer' });
  assert.equal(next.records.find(n => n.nativeId === ids[1]).subagent, true);
  assert.equal(next.records.find(n => n.nativeId === ids[1]).latestMessage, null);
});

test('role previews retain the latest visible message for each author, independent of newer opposite-role messages', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { content: jsonl([
    meta(ids[0]), message('user', 'old question'), message('assistant', 'old answer'),
    message('user', 'new question'), message('assistant', 'new answer'), message('user', 'follow-up pending'),
    message('assistant', 'hidden reasoning', 'analysis'), message('system', 'hidden system instructions'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'hidden tool output' } },
  ]) + '{"type":"response_item","payload":' });
  const before = await readFile(path);
  assert.deepEqual(await readMessagePreviews(path), {
    latest: { role: 'user', text: 'follow-up pending' }, user: { role: 'user', text: 'follow-up pending' },
    assistant: { role: 'assistant', text: 'new answer' },
  });
  assert.deepEqual(await readFile(path), before);
});

test('compressed previews support legacy events and bounded backfill finds users before large tool output', async t => {
  const { home } = await fixture(t);
  const compressed = await rollout(home, ids[0], {}, { suffix: '.zst', content: zstdCompressSync(Buffer.from(jsonl([
    meta(ids[0]), { type: 'event_msg', payload: { type: 'user_message', message: 'archived question' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'archived answer' } },
  ]))) });
  assert.deepEqual(await readMessagePreviews(compressed), {
    latest: { role: 'assistant', text: 'archived answer' }, user: { role: 'user', text: 'archived question' },
    assistant: { role: 'assistant', text: 'archived answer' },
  });
  const long = await rollout(home, ids[1], {}, { content: jsonl([
    meta(ids[1]), message('user', 'outside the retained tail'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(2 * 1024 * 1024) } },
    message('assistant', '🌳'.repeat(200)),
  ]) });
  const result = await readMessagePreviews(long);
  assert.equal(result.user.text, 'outside the retained tail');
  assert.equal(result.assistant.text, '🌳'.repeat(159) + '…');
  assert.deepEqual(await readMessagePreviews(await rollout(home, ids[2])), { latest: null, user: null, assistant: null });
});

test('known attachment and selection envelopes expose human text only', () => {
  const attached = '# Files mentioned by the user:\n\n## image.png: C:/private/image.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user\'s request.\n\n## My request:\n只显示这段正文\n<image name="Image #1" path="C:/private/image.png">pixels</image>';
  assert.equal(userBody(attached), '只显示这段正文');
  assert.equal(userBody(attached.replace('只显示这段正文', '')), '[图片]');
  assert.equal(userBody('<send_user_message_question_reply>' + JSON.stringify([{ questionItemId: 'private-call-id', question: '怎么打开？', answer: '直接打开会话树' }]) + '</send_user_message_question_reply>'), '选择：直接打开会话树');
  assert.equal(userBody('<environment_context>generated metadata</environment_context>'), '');
  assert.equal(userBody('## My request:\nThis is ordinary Markdown'), '## My request:\nThis is ordinary Markdown');
});

test('append checkpoints retain authors across oversized tool records and incomplete writes', async t => {
  const { home } = await fixture(t);
  const path = await rollout(home, ids[0], {}, { content: jsonl([meta(ids[0]), message('user', '保留这个问题'), message('assistant', '旧回答')]) });
  const first = await readPreviewState(path);
  assert.equal(await readPreviewState(path, first), first);
  await appendFile(path, jsonl([{ type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(9 * 1024 * 1024) } }, message('assistant', '新回答')]) + '{"type":"event_msg"');
  const next = await readPreviewState(path, first);
  assert.equal(next.previews.user.text, '保留这个问题');
  assert.equal(next.previews.assistant.text, '新回答');
  await appendFile(path, ',"payload":{"type":"user_message","message":"完整的新问题"}}\n');
  assert.equal((await readPreviewState(path, next)).previews.user.text, '完整的新问题');
});
