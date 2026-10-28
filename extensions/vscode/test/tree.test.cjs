const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionForest, SessionBrowser, inWorkspace } = require('../out/tree');
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

test('a session-scoped tree keeps the complete family and never substitutes another conversation', () => {
  const records = [node('root', '/old-workspace'), node('current', '/app', 'root'),
    node('archived-sibling', '/worktree', 'root', { archived: true }),
    node('descendant', '/worktree', 'current'), node('unrelated-newest', '/app')];
  const tree = SessionForest.forSession(records, 'current');
  assert.equal(tree.selectedId, 'current');
  assert.deepEqual([...tree.nodes.keys()], ['root', 'current', 'archived-sibling', 'descendant']);
  assert.deepEqual(tree.roots.map(node => node.id), ['root']);
  assert.equal(SessionForest.forSession(records, 'not-in-index').nodes.size, 0);
  assert.equal(SessionForest.forSession(records).nodes.size, 0);
});

test('the initial list opens a clicked conversation family and Back restores the complete recent list', () => {
  const session = (id, parentId, day, extra = {}) => node(id, '/app', parentId, {
    nativeId: id, updatedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, ...extra,
  });
  const records = [session('root', null, 1), session('child', 'root', 20),
    session('archived', 'root', 2, { archived: true }), session('unrelated', null, 27),
    session('worker', 'child', 28, { subagent: true })];
  const browser = new SessionBrowser();
  browser.replace(records);
  assert.equal(browser.inTree, false);
  assert.deepEqual(browser.children().map(node => node.id), ['unrelated', 'child', 'archived', 'root']);
  assert.deepEqual(browser.children(records[0]), []);
  assert.equal(browser.openTree('archived'), false);
  assert.equal(browser.openTree('unknown'), false);
  assert.equal(browser.inTree, false);
  assert.equal(browser.openTree('child'), true);
  assert.equal(browser.selectedId, 'child');
  assert.deepEqual(browser.children().map(node => node.id), ['root']);
  assert.deepEqual([...browser.forest.nodes.keys()], ['root', 'child', 'archived']);
  browser.replace([...records, session('new-branch', 'root', 28)]);
  assert.equal(browser.selectedId, 'child');
  assert.equal(browser.forest.nodes.has('new-branch'), true);
  assert.equal(browser.forest.nodes.has('unrelated'), false);
  browser.backToList();
  assert.equal(browser.inTree, false);
  assert.deepEqual(browser.children().map(node => node.id), ['new-branch', 'unrelated', 'child', 'archived', 'root']);
  browser.openTree('child');
  browser.replace([session('unrelated', null, 27)]);
  assert.equal(browser.inTree, true);
  assert.deepEqual(browser.children(), []);
});
