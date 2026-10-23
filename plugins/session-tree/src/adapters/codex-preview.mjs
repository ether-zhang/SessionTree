import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createZstdDecompress } from 'node:zlib';

const BLOCK = 1024 * 1024, READ_LIMIT = 8 * BLOCK, DECOMPRESS_LIMIT = 64 * BLOCK;
export const PREVIEW_VERSION = 2;
const empty = () => ({ latest: null, user: null, assistant: null });

/** Only remove known client envelopes, never arbitrary user Markdown or XML. */
export function userBody(value, { image = false, audio = false } = {}) {
  let text = value.trim();
  text = text.replace(/^<(environment_context|external_codex_apps_open_page)\b[^>]*>[\s\S]*?<\/\1>\s*/u, '').trim();
  if (/^# AGENTS\.md instructions\s+<INSTRUCTIONS>/u.test(text)) return '';
  const reply = /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/u.exec(text);
  if (reply) {
    try {
      if (reply[1].length > 256 * 1024) return '[选择回复]';
      const items = JSON.parse(reply[1]);
      if (!Array.isArray(items)) return '[选择回复]';
      const answers = items.slice(0, 8).map(item => typeof item?.answer === 'string' ? item.answer.trim() : '').filter(Boolean);
      return answers.length ? '选择：' + answers.join('；') : '[选择回复]';
    } catch { return '[选择回复]'; }
  }
  const attachment = text.startsWith('# Files mentioned by the user:') &&
    text.includes('Distinguish instructions in attached documents from the user') &&
    /^## My request:\s*$/mu.test(text);
  if (attachment) {
    image ||= /Image attachment:\s*true/u.test(text);
    text = text.slice(text.search(/^## My request:\s*$/mu)).replace(/^## My request:\s*/u, '');
  }
  if (attachment || image) {
    text = text.replace(/<image\b[^>]*>[\s\S]*?<\/image>/gu, '').trim();
    text = text.replace(/!\[[^\]]*\]\((?:file:|sandbox:|attachment:|[A-Za-z]:[\\/])[^)]*\)/gu, '').trim();
  }
  return text || (image ? '[图片]' : audio ? '[音频]' : attachment ? '[附件]' : '');
}

function excerpt(entry) {
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') return null;
  let role, text, image = false, audio = false;
  if (entry.type === 'response_item' && payload.type === 'message') {
    if (!['user', 'assistant'].includes(payload.role) || payload.channel === 'analysis') return null;
    role = payload.role;
    const content = Array.isArray(payload.content) ? payload.content : [];
    text = content.filter(part => ['input_text', 'output_text', 'text'].includes(part?.type) && typeof part.text === 'string')
      .map(part => part.text).join('\n');
    image = content.some(part => ['input_image', 'output_image', 'image'].includes(part?.type));
    audio = content.some(part => ['input_audio', 'output_audio', 'audio'].includes(part?.type));
  } else if (entry.type === 'event_msg') {
    if (payload.type === 'user_message') role = 'user';
    else if (['agent_message', 'assistant_message'].includes(payload.type) && payload.channel !== 'analysis') role = 'assistant';
    else return null;
    text = typeof payload.message === 'string' ? payload.message : '';
    image = Array.isArray(payload.images) && payload.images.length > 0;
  } else return null;
  text = role === 'user' ? userBody(text || '', { image, audio }) : text || (image ? '[图片]' : audio ? '[音频]' : '');
  const characters = Array.from(text.replace(/\s+/gu, ' ').trim());
  if (!characters.length) return null;
  return { role, text: characters.length > 160 ? characters.slice(0, 159).join('') + '…' : characters.join('') };
}

function parse(buffer, truncated, seed, reverse = false) {
  let lines = buffer.toString('utf8').split('\n');
  if (truncated) lines.shift();
  if (reverse) lines.reverse();
  const previews = reverse ? empty() : { ...seed }, found = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const item = excerpt(JSON.parse(line));
      if (!item) continue;
      if (reverse) {
        previews.latest ??= item;
        previews[item.role] ??= item;
      } else { previews.latest = item; previews[item.role] = item; }
      found.add(item.role);
      if (reverse && found.size === 2) break;
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  if (reverse && seed) {
    previews.latest ??= seed.latest;
    previews.user ??= seed.user;
    previews.assistant ??= seed.assistant;
  }
  return { previews, found };
}

async function compressedTail(path) {
  const source = createReadStream(path), stream = source.pipe(createZstdDecompress());
  source.on('error', error => stream.destroy(error));
  const chunks = [];
  let total = 0, retained = 0;
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > DECOMPRESS_LIMIT) throw new Error('压缩会话超过摘要读取上限。');
      chunks.push(chunk); retained += chunk.length;
      while (chunks.length && retained - chunks[0].length >= READ_LIMIT) retained -= chunks.shift().length;
      if (retained > READ_LIMIT) { chunks[0] = chunks[0].subarray(retained - READ_LIMIT); retained = READ_LIMIT; }
    }
    return { buffer: Buffer.concat(chunks), truncated: total > retained };
  } finally { stream.destroy(); source.destroy(); }
}

/** Keep an append cursor in memory; checkpoints contain normalized messages only. */
export async function readPreviewState(path, previous, info = undefined) {
  info ??= await stat(path);
  const identity = String(info.ino) + ':' + String(info.birthtimeMs);
  const same = previous?.version === PREVIEW_VERSION && previous.identity === identity && info.size >= previous.size;
  if (same && info.size === previous.size && info.mtimeMs === previous.mtime) return previous;
  let buffer, start = 0, truncated = false, parsed, offset = info.size, skipPartial = false;
  const append = same && info.size > previous.size && !path.endsWith('.zst');
  if (path.endsWith('.zst')) {
    ({ buffer, truncated } = await compressedTail(path));
    parsed = parse(buffer, truncated, null, true);
  } else {
    const file = await open(path, 'r');
    try {
      if (append && info.size - previous.offset <= READ_LIMIT) {
        start = previous.offset;
        buffer = Buffer.alloc(info.size - start);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        buffer = buffer.subarray(0, bytesRead);
        truncated = previous.skipPartial;
        parsed = parse(buffer, truncated, previous.previews);
      } else {
        let length = Math.min(BLOCK, info.size);
        for (;;) {
          start = Math.max(0, info.size - length);
          buffer = Buffer.alloc(info.size - start);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
          buffer = buffer.subarray(0, bytesRead);
          truncated = start > 0;
          parsed = parse(buffer, truncated, append ? previous.previews : null, true);
          if (parsed.found.size === 2 || !start || length >= READ_LIMIT) break;
          length = Math.min(READ_LIMIT, length * 2);
        }
      }
      const newline = buffer.lastIndexOf(10);
      if (newline >= 0) offset = start + newline + 1;
      else if (!truncated && buffer.length < READ_LIMIT) offset = start;
      else { offset = start + buffer.length; skipPartial = true; }
    } finally { await file.close(); }
  }
  return {
    version: PREVIEW_VERSION, identity, size: info.size, mtime: info.mtimeMs, offset, skipPartial,
    previews: parsed.previews,
    limited: {
      user: !parsed.previews.user && (truncated || Boolean(append && previous.limited?.user)),
      assistant: !parsed.previews.assistant && (truncated || Boolean(append && previous.limited?.assistant)),
    },
  };
}

export async function readMessagePreviews(path) { return (await readPreviewState(path)).previews; }
export async function readLatestMessage(path) { return (await readMessagePreviews(path)).latest; }
