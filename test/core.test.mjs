import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndex, selectTree, descendants, selectFamily } from '../plugins/session-tree/src/core/tree.mjs';

const record = (id, extra = {}) => ({ id, agent: 'example-agent', nativeId: id, title: id, ...extra });

test('generic tree preserves multi-level forks and adds a missing source', () => {
  const index = createIndex([record('root'), record('fork', { parentId: 'root' }), record('deep', { parentId: 'fork' }), record('orphan', { parentId: 'gone' })]);
  const view = selectTree(index);
  assert.deepEqual(view.roots.map(node => node.id), ['gone', 'root']);
  assert.deepEqual(descendants('root', view.children), ['root', 'fork', 'deep']);
  assert.equal(index.nodes.find(node => node.id === 'gone').missing, true);
  assert.deepEqual(index.issues, [{ kind: 'missing-parent', id: 'orphan', parentId: 'gone' }]);
});

test('cycles and self-links are broken deterministically without dropping sessions', () => {
  const records = [record('b', { parentId: 'a' }), record('a', { parentId: 'b' }), record('self', { parentId: 'self' })];
  const first = createIndex(records, { generatedAt: 'fixed' });
  assert.deepEqual(first, createIndex([...records].reverse(), { generatedAt: 'fixed' }));
  assert.deepEqual(first.nodes.filter(node => !node.parentId).map(node => node.id), ['a', 'self']);
  assert.equal(selectTree(first).nodes.length, 3);
});

test('search and workspace filters retain archived ancestors as context', () => {
  const index = createIndex([record('parent', { archived: true, workspace: 'old' }), record('hit', { parentId: 'parent', workspace: 'new' }), record('other')]);
  const view = selectTree(index, { query: 'hit', workspace: 'new' });
  assert.deepEqual(view.nodes.map(node => [node.id, node.contextOnly]), [['hit', false], ['parent', true]]);
  assert.deepEqual([...view.matches], ['hit']);
  assert.deepEqual(selectTree(index, { query: 'absent' }).nodes, []);
});

test('subagents are optional and duplicate IDs are rejected', () => {
  const index = createIndex([record('parent'), record('agent', { parentId: 'parent', subagent: true, relation: 'spawn' })]);
  assert.equal(selectTree(index).nodes.length, 1);
  assert.equal(selectTree(index, { subagents: true }).nodes.length, 2);
  assert.throws(() => createIndex([record('same'), record('same')]), /Duplicate/);
});

test('deep chains do not overflow', () => {
  const index = createIndex(Array.from({ length: 6000 }, (_, i) => record(String(i), { parentId: i ? String(i - 1) : null })));
  const view = selectTree(index), root = view.roots[0];
  assert.equal(descendants(root.id, view.children).length, 6000);
});

test('current-node family includes ancestors, siblings and descendants but no unrelated chats', () => {
  const index = createIndex([
    record('root', { archived: true }), record('current', { parentId: 'root' }),
    record('sibling', { parentId: 'root' }), record('child', { parentId: 'current' }), record('unrelated'),
  ]);
  const family = selectFamily(index, 'current');
  assert.equal(family.rootId, 'root');
  assert.equal(family.currentId, 'current');
  assert.deepEqual(family.nodes.map(node => node.id), ['child', 'current', 'root', 'sibling']);
  assert.equal(family.nodes.find(node => node.id === 'root').archived, true);
  assert.equal(index.nodes.length, 5);
});

test('unknown current node produces an empty family instead of falling back to another chat', () => {
  const index = createIndex([record('other')]);
  assert.deepEqual(selectFamily(index, 'unknown'), { ...index, nodes: [], issues: [], rootId: null, currentId: 'unknown' });
});

test('family resolution keeps missing-source placeholders and supports deep forks', () => {
  const orphan = selectFamily(createIndex([record('current', { parentId: 'gone' })]), 'current');
  assert.equal(orphan.rootId, 'gone');
  assert.equal(orphan.nodes.find(node => node.id === 'gone').missing, true);
  const index = createIndex(Array.from({ length: 6000 }, (_, i) => record(String(i), { parentId: i ? String(i - 1) : null })));
  assert.equal(selectFamily(index, '5999').nodes.length, 6000);
});
