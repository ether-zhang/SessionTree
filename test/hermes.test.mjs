import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndex, selectFamily } from '../plugins/session-tree/src/core/tree.mjs';
import { HermesAdapter, hermesKey, mapHermesSessions } from '../plugins/session-tree/src/adapters/hermes.mjs';
import { HermesTreeHost } from '../plugins/session-tree/src/ui/hermes/host.mjs';
import { previewLines } from '../plugins/session-tree/src/ui/shared/conversation-view.mjs';
import { createHermesSdkSource } from '../plugins/session-tree/src/adapters/hermes-sdk.mjs';

const scope = { connectionId: 'local', profile: 'default' };
const row = (id, extra = {}) => ({ id, title: id, source: 'desktop', started_at: 10, last_active: 20, preview: '', ...extra });
const fixtures = () => [
  row('root'), row('middle', { parent_session_id: 'root', _lineage_root_id: 'root' }),
  row('tip', { parent_session_id: 'middle', _lineage_root_id: 'root', _lineage_ids: ['root', 'middle', 'tip'], continuation_kind: 'compression' }),
  row('fork', { _branched_from: 'middle', parent_session_id: 'middle', preview: 'A real visible summary' }),
  row('reset', { _reset_from: 'tip', parent_session_id: 'tip' }),
  row('worker', { is_internal_child: true }), row('hidden', { hidden: true }),
];

test('Hermes folds compression, preserves explicit forks and keeps resets out of the family', () => {
  const mapped = mapHermesSessions(fixtures(), scope);
  const index = createIndex(mapped.records), rootId = hermesKey(scope, 'root');
  assert.deepEqual(mapped.records.map(item => item.nativeId).sort(), ['fork', 'reset', 'tip']);
  assert.equal(mapped.aliases.get('middle'), rootId);
  assert.equal(mapped.records.find(item => item.nativeId === 'fork').parentId, rootId);
  assert.equal(mapped.records.find(item => item.nativeId === 'reset').parentId, null);
  assert.deepEqual(selectFamily(index, rootId).nodes.map(item => item.nativeId).sort(), ['fork', 'tip']);
  assert.deepEqual(previewLines(mapped.records.find(item => item.nativeId === 'fork')), ['A real visible summary']);
  const orphan = createIndex(mapHermesSessions([row('orphan', { _branched_from: 'gone' })], scope).records);
  assert.ok(orphan.nodes.find(item => item.id === hermesKey(scope, 'gone')).missing);
  const unknown = mapHermesSessions([row('legacy', { parent_session_id: 'unclassified' })], scope);
  assert.equal(unknown.records[0].parentId, null);
  assert.equal(unknown.issues[0].kind, 'ancestry-unavailable');
});

test('Hermes owner identity and invalidation preserve cache without crossing profiles or sources', async () => {
  assert.notEqual(hermesKey(scope, 'same'), hermesKey({ ...scope, profile: 'another' }, 'same'));
  assert.notEqual(hermesKey(scope, 'same'), hermesKey({ ...scope, connectionId: 'remote' }, 'same'));
  assert.throws(() => mapHermesSessions([row('wrong', { profile: 'another' })], scope), /another owner/);
  let reads = 0;
  const adapter = new HermesAdapter({ ...scope, readSessions: async () => { reads++; return { sessions: fixtures(), total: 7 }; } });
  await adapter.scan({ force: false });
  const version = adapter.revision;
  assert.ok((await adapter.scan({ force: false })).unchanged);
  assert.equal(reads, 1);
  adapter.invalidate();
  assert.ok((await adapter.scan({ force: false })).unchanged);
  assert.equal(reads, 2);
  assert.equal(adapter.revision, version);
});

test('Hermes host follows sessions without replacing the host and validates native navigation', async () => {
  let context = { ...scope, sessionId: 'middle' }, reads = 0;
  const opened = [], host = new HermesTreeHost({
    readContext: () => context,
    readSessions: async () => { reads++; return { sessions: fixtures(), total: 7 }; },
    openSession: async target => opened.push(target),
  });
  const first = await host.loadPanel();
  assert.equal(first.index.currentId, hermesKey(scope, 'root'));
  context = { ...context, sessionId: 'fork' }; host.contextChanged();
  const next = await host.loadPanel();
  assert.equal(next.index.currentId, hermesKey(scope, 'fork'));
  assert.equal(reads, 1);
  await host.openNode({ id: hermesKey(scope, 'root') });
  assert.deepEqual(opened, [{ ...scope, sessionId: 'tip' }]);
  await assert.rejects(host.openNode({ id: 'hermes:local:another:root' }), /cannot be opened/);
  context = { ...context, profile: 'another' };
  await assert.rejects(host.openNode({ id: hermesKey(scope, 'root') }), /cannot be opened/);
  host.close();
});

test('Hermes discards an asynchronous list after a session or owner changes', async () => {
  let context = { ...scope, sessionId: 'root' }, finish;
  const host = new HermesTreeHost({
    readContext: () => context, readSessions: () => new Promise(resolve => { finish = resolve; }), openSession: () => {},
  });
  const pending = host.loadPanel();
  context = { ...context, profile: 'another' };
  finish({ sessions: fixtures() });
  await assert.rejects(pending, /session changed/);
  host.close();
});

test('Hermes closes and reopens without adopting the disposed adapter response', async () => {
  let finish;
  const host = new HermesTreeHost({ readContext: () => ({ ...scope, sessionId: 'root' }),
    readSessions: () => new Promise(resolve => { finish = resolve; }), openSession: () => {} });
  const pending = host.loadPanel();
  host.close(); finish({ sessions: fixtures() });
  await assert.rejects(pending, /session changed/);
});

test('Hermes SDK source reads a pinned route, translates profile aliases and never opens through ambient state', async () => {
  const owner = { connectionId: 'remote-registry-id', profile: 'desktop-alias' };
  const route = { ...owner, targetProfile: 'backend-profile', mode: 'remote' };
  const calls = [], sdk = {
    state: { focusedSessionOwner: { get: () => owner }, focusedStoredSessionId: { get: () => 'same-id' } },
    profileRoutes: async () => [route],
    listPersistedSessions: async (...args) => {
      calls.push(args);
      return { sessions: [row('same-id', { profile: 'backend-profile' })], total: 1 };
    },
    openSession: async (...args) => calls.push(args),
  };
  const source = createHermesSdkSource(sdk);
  assert.deepEqual(source.readContext(), { ...owner, sessionId: 'same-id' });
  const page = await source.readSessions(owner);
  assert.deepEqual(calls[0], [route, { profile: 'backend-profile', limit: 500 }]);
  assert.equal(page.sessions[0].profile, 'desktop-alias');
  assert.equal(page.sessions[0].connection_id, owner.connectionId);
  await source.openSession({ ...owner, sessionId: 'same-id' });
  assert.deepEqual(calls[1], ['same-id', { route, intent: 'in-place', keepAllProfilesScope: true }]);
  sdk.listPersistedSessions = async () => ({ sessions: [row('foreign', { profile: 'another-backend' })] });
  await assert.rejects(source.readSessions(owner), /another profile/);
});

test('a later focused session cancels native navigation while its route is resolving', async () => {
  let focus = 'old', finish, opened = 0;
  const source = createHermesSdkSource({
    state: { focusedSessionOwner: { get: () => scope }, focusedStoredSessionId: { get: () => focus } },
    profileRoutes: () => new Promise(resolve => { finish = resolve; }), openSession: () => { opened++; },
  });
  const pending = source.openSession({ ...scope, sessionId: 'target' });
  focus = 'newer-intent'; finish([{ ...scope, targetProfile: 'default', mode: 'local' }]);
  await assert.rejects(pending, /session changed/);
  assert.equal(opened, 0);
});
