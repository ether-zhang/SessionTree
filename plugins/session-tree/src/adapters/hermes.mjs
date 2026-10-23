const text = value => typeof value === 'string' ? value.trim() : '';
const recent = row => Number(row.last_active || row.started_at || 0);

export function hermesScope(value) {
  if (!text(value?.connectionId) || !text(value?.profile)) throw new Error('Hermes must provide the session connection and profile.');
  return Object.freeze({ connectionId: text(value.connectionId), profile: text(value.profile) });
}

export function hermesKey(scope, sessionId) {
  if (!text(sessionId)) throw new Error('Hermes session id is missing.');
  return ['hermes', scope.connectionId, scope.profile, sessionId].map(encodeURIComponent).join(':');
}

function iso(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/**
 * Convert the native SessionInfo contract, not SQLite parent pointers in isolation.
 * Compression segments share one stable node; /new resets never become forks.
 */
export function mapHermesSessions(sessions, context) {
  const scope = hermesScope(context), groups = new Map(), issues = [], aliases = new Map();
  for (const row of sessions) {
    if (!text(row?.id)) throw new Error('Hermes returned a session without an id.');
    if ((row.connection_id && row.connection_id !== scope.connectionId) ||
        (row.profile && row.profile !== scope.profile)) throw new Error('Hermes returned sessions belonging to another owner.');
    if (row.hidden || row.is_internal_child) continue;
    const root = text(row._lineage_root_id) || row.id;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  }
  const entries = [];
  for (const [root, rows] of groups) {
    const continued = new Set(rows.map(row => row.parent_session_id));
    const ordered = [...rows].sort((a, b) =>
      Number(continued.has(a.id)) - Number(continued.has(b.id)) || recent(b) - recent(a) || a.id.localeCompare(b.id));
    const tip = ordered[0], id = hermesKey(scope, root);
    for (const row of rows) {
      aliases.set(row.id, id);
      for (const oldId of row._lineage_ids || []) if (text(oldId)) aliases.set(oldId, id);
    }
    aliases.set(root, id);
    entries.push({ root, id, tip, rows });
  }
  const records = entries.map(({ root, id, tip, rows }) => {
    const reset = rows.some(row => text(row._reset_from));
    const parent = reset ? '' : text(rows.find(row => text(row._branched_from))?._branched_from);
    const parentId = parent ? aliases.get(parent) || hermesKey(scope, parent) : null;
    const ambiguous = !parent && !reset && !tip.continuation_kind && !tip._lineage_root_id && text(tip.parent_session_id);
    if (ambiguous) issues.push({ kind: 'ancestry-unavailable', id });
    const started = rows.map(row => row.started_at).filter(value => value != null && Number.isFinite(Number(value)));
    return {
      id, agent: 'hermes', nativeId: tip.id, parentId: parentId === id ? null : parentId,
      relation: parentId && parentId !== id ? 'fork' : null,
      title: (text(tip.title) || 'Session ' + root).slice(0, 240), workspace: text(tip.cwd),
      createdAt: iso(started.length ? Math.min(...started.map(Number)) : null), updatedAt: iso(recent(tip)),
      archived: Boolean(tip.archived), subagent: false,
      summary: text(tip.preview).replace(/\s+/g, ' ').slice(0, 160),
      latestMessages: { user: null, assistant: null },
      navigation: { ...scope, sessionId: tip.id },
      ancestryUnknown: Boolean(ambiguous),
    };
  });
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { records, issues, aliases };
}

/** The source is injected by Hermes UI; this adapter has no DOM, credentials, or HTTP client. */
export class HermesAdapter {
  constructor({ readSessions, connectionId, profile }) {
    if (typeof readSessions !== 'function') throw new TypeError('A Hermes session source is required.');
    this.scope = hermesScope({ connectionId, profile });
    this.readSessions = readSessions;
    this.generation = 0;
    this.revision = 0;
    this.dirty = true;
  }
  invalidate() { this.generation++; this.dirty = true; }
  async scan({ force = true } = {}) {
    if (!force && !this.dirty && this.result) return { ...this.result, unchanged: true };
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.pending = (async () => {
      const page = await this.readSessions(this.scope);
      if (!Array.isArray(page?.sessions)) throw new Error('Hermes returned an invalid session list.');
      if (page.errors?.length) throw new Error('Hermes could not read all requested session data.');
      const result = mapHermesSessions(page.sessions, this.scope);
      if (Number(page.total) > page.sessions.length) {
        result.issues.push({ kind: 'partial-index', loaded: page.sessions.length, total: Number(page.total) });
      }
      const signature = JSON.stringify([result.records, result.issues]);
      const unchanged = signature === this.signature;
      if (!unchanged) {
        this.signature = signature; this.revision++;
      }
      this.result = result;
      this.dirty = generation !== this.generation;
      return { ...this.result, unchanged };
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  resolveId(nativeId) {
    return this.result?.aliases.get(nativeId) || (nativeId ? hermesKey(this.scope, nativeId) : null);
  }
}
