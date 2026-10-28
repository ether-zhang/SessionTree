const test = require('node:test');
const assert = require('node:assert/strict');
const { fitCamera, zoomCamera } = require('../out/graph-layout');
const node = (id, parentId, day) => ({ id, parentId, title: id, agent: 'fixture', workspace: '/example',
  createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z` });

test('fixed title boxes form a left-to-right tree with nonoverlapping branches and stable positions', async () => {
  const { boxTree, edgePath } = await import('../../../frontend/vscode/layout.ts');
  const records = [node('root', null, 1), node('other', 'root', 2), node('other-child', 'other', 3),
    node('selected', 'root', 4), node('leaf', 'selected', 5)];
  const graph = boxTree(records);
  const positions = new Map(graph.nodes.map(item => [item.node.id, item]));
  assert.equal(graph.nodes.length, records.length);
  assert.equal(graph.edges.length, records.length - 1);
  for (const item of graph.nodes) {
    assert.equal(item.width, 120); assert.equal(item.height, 32);
    if (!item.node.parentId) continue;
    assert.ok(item.x > positions.get(item.node.parentId).x);
    assert.ok(graph.edges.some(edge => edge.from === item.node.parentId && edge.to === item.node.id));
  }
  assert.notEqual(positions.get('other').y, positions.get('selected').y);
  assert.ok(positions.get('other').y + positions.get('other').height < positions.get('selected').y);
  const signature = graph => graph.nodes.map(({ node, x, y, width, height }) => [node.id, x, y, width, height]);
  const changed = boxTree([...records].reverse().map(item => ({ ...item, updatedAt: '2026-10-28T12:00:00Z' })));
  assert.deepEqual(signature(changed), signature(graph));
  assert.ok(graph.edges.every(edge => edge.x2 > edge.x1 && !/NaN|undefined/.test(edgePath(edge))));
});

test('long ancestry reuses the common nonrecursive layout and keeps a fixed row height', async () => {
  const { boxTree } = await import('../../../frontend/vscode/layout.ts');
  const records = Array.from({ length: 5000 }, (_, index) => node('n' + index, index ? 'n' + (index - 1) : null, 1));
  const graph = boxTree(records);
  assert.equal(graph.nodes.length, 5000);
  assert.equal(graph.edges.length, 4999);
  assert.equal(new Set(graph.nodes.map(item => item.y)).size, 1);
  assert.ok(graph.height < 100);
});

test('zoom preserves the point under the pointer and fit keeps a normal family in its viewport', async () => {
  const { boxTree } = await import('../../../frontend/vscode/layout.ts');
  const old = { x: 16, y: -30, scale: .8 }, point = { x: 140, y: 180 };
  const zoomed = zoomCamera(old, 1.4, point.x, point.y);
  assert.ok(Math.abs((point.x - old.x) / old.scale - (point.x - zoomed.x) / zoomed.scale) < 1e-8);
  assert.ok(Math.abs((point.y - old.y) / old.scale - (point.y - zoomed.y) / zoomed.scale) < 1e-8);
  const graph = boxTree([node('r', null, 1), node('a', 'r', 2), node('b', 'r', 3)]);
  const fit = fitCamera(graph, 360, 580);
  assert.ok(fit.x >= 0 && fit.y >= 0);
  assert.ok(fit.x + graph.width * fit.scale <= 360);
  assert.ok(fit.y + graph.height * fit.scale <= 580);
});
