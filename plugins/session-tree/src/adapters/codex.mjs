import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';
import { join, resolve } from 'node:path';
import { readPreviewState, PREVIEW_VERSION } from './codex-preview.mjs';
import { CodexChanges, pathKey } from './codex-changes.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const key = id => `codex:${id}`;
const fileKey = path => process.platform === 'win32' ? resolve(path).replace(/^\\\\\?\\/, '').toLowerCase() : resolve(path);
const title = value => value.length > 240 ? `${value.slice(0, 239)}…` : value;

async function* lines(path) {
  const source = createReadStream(path);
  const stream = path.endsWith('.zst') ? source.pipe(createZstdDecompress()) : source;
  if (stream !== source) source.on('error', error => stream.destroy(error));
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of reader) yield line; }
  finally { reader.close(); stream.destroy(); source.destroy(); }
}

async function rolloutFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await rolloutFiles(path));
    else if (entry.isFile() && /^rollout-.*\.jsonl(?:\.zst)?$/.test(entry.name)) result.push(path);
  }
  return result;
}

/** The first metadata record is canonical: forks may contain copied parent metadata later. */
export async function readSessionMeta(path) {
  let bytes = 0;
  for await (const line of lines(path)) {
    bytes += Buffer.byteLength(line);
    if (bytes > 4 * 1024 * 1024) throw new Error('Session metadata exceeds the 4 MiB read limit.');
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'session_meta' && UUID.test(entry.payload?.id)) return entry.payload;
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  throw new Error('No valid session metadata found.');
}

async function readNames(home, issues) {
  const names = new Map();
  try {
    for await (const line of lines(join(home, 'session_index.jsonl'))) {
      try {
        const entry = JSON.parse(line);
        if (UUID.test(entry.id) && typeof entry.thread_name === 'string') names.set(entry.id, entry);
      } catch { /* An interrupted append must not hide the remaining index. */ }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') issues.push({ kind: 'name-index-unavailable', message: error.message });
  }
  return names;
}

async function readState(home, issues) {
  const candidates = (await readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!candidates.length) return [];
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(join(home, candidates[0]), { readOnly: true });
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(column => column.name));
    const wanted = ['id', 'rollout_path', 'title', 'name', 'cwd', 'source', 'archived', 'created_at', 'updated_at', 'created_at_ms', 'updated_at_ms'];
    return db.prepare(`SELECT ${wanted.filter(column => columns.has(column)).join(', ')} FROM threads`).all();
  } catch {
    issues.push({ kind: 'state-unavailable', message: '会话数据库暂不可读，已使用本地会话文件和名称索引。' });
    return [];
  } finally { db?.close(); }
}

function timestamp(value, millis) {
  if (millis != null || value != null) {
    const date = new Date(millis ?? Number(value) * 1000);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return null;
}

function subagentSource(source) {
  if (source && typeof source === 'object') return Boolean(source.subagent || source.subAgent);
  if (typeof source !== 'string') return false;
  if (['subagent', 'sub_agent', 'thread_spawn'].includes(source.toLowerCase())) return true;
  try { return subagentSource(JSON.parse(source)); } catch { return false; }
}

/** Agent adapter contract: scan() returns { records, issues }; no tree or UI logic here. */
export class CodexAdapter {
  constructor(home) {
    this.home = home; this.cache = new Map(); this.fileIssues = new Map(); this.recordsByPath = new Map();
    this.changes = new CodexChanges(home);
  }
  async scan({ force = true } = {}) {
    const change = this.changes.take(force);
    if (!change && this.result) return { ...this.result, unchanged: true };
    try { return await this.scanChanges(change); }
    catch (error) { this.changes.pending.full = true; throw error; }
  }
  async scanChanges(change) {
    // Missing configuration is an error, not an empty replacement for a previous index.
    await readdir(this.home);
    const issues = [], records = new Map();
    if (change.names || !this.names) {
      this.nameIssues = [];
      const names = await readNames(this.home, this.nameIssues);
      if (!this.nameIssues.length || !this.names) this.names = names;
    }
    if (change.state || !this.state) {
      this.stateIssues = [];
      const state = await readState(this.home, this.stateIssues);
      if (!this.stateIssues.length || !this.state) this.state = state;
    }
    issues.push(...this.nameIssues, ...this.stateIssues);
    const names = this.names, state = this.state;
    const rows = new Map(state.filter(row => UUID.test(row.id)).map(row => [row.id, row]));
    const files = change.discover || !this.files ? new Map() : new Map(this.files);
    if (change.discover || !this.files) {
      for (const [directory, archived] of [['sessions', false], ['archived_sessions', true]]) {
        for (const path of await rolloutFiles(join(this.home, directory))) files.set(path, archived);
      }
    }
    const knownFiles = new Set([...files.keys()].map(fileKey));
    for (const path of change.paths) if (!knownFiles.has(fileKey(path))) {
      files.set(path, fileKey(path).startsWith(fileKey(join(this.home, 'archived_sessions'))));
      knownFiles.add(fileKey(path));
    }
    for (const row of rows.values()) if (row.rollout_path && !knownFiles.has(fileKey(row.rollout_path)) && !knownFiles.has(fileKey(`${row.rollout_path}.zst`))) {
      files.set(row.rollout_path, Boolean(row.archived));
      knownFiles.add(fileKey(row.rollout_path));
    }
    const seen = new Set();
    for (const [path, archived] of files) {
      try {
        const cached = this.cache.get(path);
        const check = change.full || !cached || change.paths.has(pathKey(path));
        const info = check ? await stat(path) : cached.info;
        const unchanged = cached?.size === info.size && cached?.mtime === info.mtimeMs &&
          cached?.info.ino === info.ino && cached?.info.birthtimeMs === info.birthtimeMs;
        const appended = cached && info.size > cached.size && info.ino === cached.info.ino && info.birthtimeMs === cached.info.birthtimeMs;
        const meta = unchanged || appended ? cached.meta : await readSessionMeta(path);
        seen.add(path);
        const row = rows.get(meta.id), name = names.get(meta.id);
        const spawned = meta.parent_thread_id || meta.source?.subagent?.thread_spawn?.parent_thread_id;
        const parent = meta.forked_from_id || spawned;
        const subagent = Boolean(spawned || subagentSource(meta.source) || subagentSource(row?.source));
        let previewState = unchanged ? cached.previewState : null;
        let fileIssues = unchanged ? this.fileIssues.get(path) || [] : [];
        if ((!unchanged || fileIssues.length) && !subagent) {
          const retry = fileIssues.length > 0;
          fileIssues = [];
          try { previewState = await readPreviewState(path, retry ? undefined : cached?.previewState, info); }
          catch {
            previewState = appended ? cached.previewState : null;
            fileIssues.push({ kind: 'preview-unavailable', id: key(meta.id), message: '此会话的最新消息暂不可读。' });
          }
        }
        this.fileIssues.set(path, fileIssues);
        issues.push(...fileIssues);
        const previews = previewState?.previews;
        this.cache.set(path, { size: info.size, mtime: info.mtimeMs, info, meta, previewState });
        const record = {
          id: key(meta.id), agent: 'codex', nativeId: meta.id,
          parentId: UUID.test(parent) ? key(parent) : null, relation: meta.forked_from_id ? 'fork' : spawned ? 'spawn' : null,
          title: title(row?.name || name?.thread_name || row?.title || meta.agent_nickname || `会话 ${meta.id.slice(0, 8)}`),
          workspace: row?.cwd || meta.cwd || '',
          createdAt: timestamp(row?.created_at, row?.created_at_ms) || meta.timestamp || info.birthtime.toISOString(),
          updatedAt: timestamp(row?.updated_at, row?.updated_at_ms) || info.mtime.toISOString(),
          archived: row ? Boolean(row.archived) : archived,
          subagent, latestMessage: previews?.latest || null,
          latestMessages: { user: previews?.user?.text || null, assistant: previews?.assistant?.text || null },
          previewVersion: PREVIEW_VERSION,
          previewStatus: Object.fromEntries(['user', 'assistant'].map(role => [role,
            fileIssues.length ? 'unavailable' : previews?.[role] ? 'available' : previewState?.limited?.[role] ? 'limited' : 'empty'])),
          openUrl: `codex://threads/${meta.id}`,
        };
        const existing = records.get(record.id);
        if (!existing || record.updatedAt > existing.updatedAt) records.set(record.id, record);
        this.recordsByPath.set(path, record);
      } catch (error) {
        const previous = this.recordsByPath.get(path);
        if (previous && error.code !== 'ENOENT') { records.set(previous.id, previous); seen.add(path); }
        issues.push({ kind: 'rollout-unavailable', file: path.split(/[\\/]/).pop(), message: error.message });
      }
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) {
      this.cache.delete(path); this.fileIssues.delete(path); this.recordsByPath.delete(path);
    }
    this.files = files;
    // DB-only sessions remain findable, but their ancestry is explicitly unknown.
    for (const row of rows.values()) if (!records.has(key(row.id))) {
      records.set(key(row.id), {
        id: key(row.id), agent: 'codex', nativeId: row.id, parentId: null, relation: null,
        title: title(row.name || names.get(row.id)?.thread_name || row.title || `会话 ${row.id.slice(0, 8)}`),
        workspace: row.cwd || '', archived: Boolean(row.archived), subagent: subagentSource(row.source), latestMessage: null,
        latestMessages: { user: null, assistant: null },
        previewVersion: PREVIEW_VERSION, previewStatus: { user: 'unavailable', assistant: 'unavailable' },
        createdAt: timestamp(row.created_at, row.created_at_ms), updatedAt: timestamp(row.updated_at, row.updated_at_ms),
        openUrl: `codex://threads/${row.id}`, ancestryUnknown: true,
      });
      issues.push({ kind: 'ancestry-unavailable', id: key(row.id) });
    }
    this.result = { records: [...records.values()], issues };
    return this.result;
  }
  close() { this.changes.close(); }
}
