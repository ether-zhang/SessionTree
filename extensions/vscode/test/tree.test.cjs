const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionForest, inWorkspace } = require('../out/tree');
const node = (id, workspace, parentId, extra = {}) => ({ id, workspace, parentId, agent: 'fixture', title: id, ...extra });

test('workspace filtering preserves complete families across worktrees, archives and missing ancestors', () => {
  const records = [node('root', '', null, { missing: true }), node('selected', 'D:/Project/App', 'root'),
    node('sibling', 'D:/worktrees/other', 'root', { archived: true }), node('grandchild', 'D:/worktrees/other', 'sibling'),
    node('unrelated', 'D:/Project/Application', null), node('agent', 'D:/Project/App', 'selected', { subagent: true })];
  const tree = new SessionForest(records, ['d:\\project\\APP'], true);
  assert.deepEqual([...tree.nodes.keys()].sort(), ['grandchild', 'root', 'selected', 'sibling']);
  assert.deepEqual(tree.roots.map(node => node.id), ['root']);
  assert.equal(tree.parents.get('grandchild'), 'sibling');
  assert.equal(tree.nodes.get('sibling').archived, true);
  assert.equal(inWorkspace('D:/Project/Application', ['D:/Project/App']), false);
  assert.equal(new SessionForest(records, [], true).nodes.size, 0);
  assert.equal(new SessionForest(records, [], false).nodes.size, 5);
});

test('a malformed future provider cannot create an unrooted or cyclic native tree', () => {
  const tree = new SessionForest([node('a', '/app', 'b'), node('b', '/app', 'a'), node('orphan', '/app', 'gone')], ['/app'], true);
  const seen = new Set(), queue = [...tree.roots];
  while (queue.length) {
    const item = queue.pop();
    assert.ok(!seen.has(item.id)); seen.add(item.id);
    queue.push(...tree.children.get(item.id) ?? []);
  }
  assert.equal(seen.size, 3);
});

test('latest descendant activity moves the complete family and branch ahead of older alphabetical titles', () => {
  const at = day => `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`;
  const tree = new SessionForest([
    node('a-old', '/app', null, { title: 'A older conversation', updatedAt: at(1) }),
    node('z-recent', '/app', null, { title: 'Z recently active', updatedAt: at(20) }),
    node('a-child-old', '/worktree', 'a-old', { updatedAt: at(2) }),
    node('z-child-new', '/worktree', 'a-old', { updatedAt: at(3) }),
    node('grandchild', '/worktree', 'z-child-new', { updatedAt: at(27) }),
    node('created-only', '/app', null, { createdAt: at(10) }),
    node('unknown-time', '/app', null, { updatedAt: 'invalid' }),
  ], ['/app'], true);
  assert.deepEqual(tree.roots.map(node => node.id), ['a-old', 'z-recent', 'created-only', 'unknown-time']);
  assert.deepEqual(tree.children.get('a-old').map(node => node.id), ['z-child-new', 'a-child-old']);
  assert.equal(tree.parents.get('grandchild'), 'z-child-new');
});
