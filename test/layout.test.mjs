import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndex, selectTree } from '../plugins/session-tree/src/core/tree.mjs';
import { horizontalTree, horizontalEdgePath } from '../plugins/session-tree/src/core/layout.mjs';

test('arrow arrivals remain horizontal beyond the arrow footprint on steep branches', () => {
  for (const y2 of [-300, 0, 300]) {
    const edge = { x1: 288, y1: 0, x2: 336, y2 };
    const parts = horizontalEdgePath(edge).split(/\s*[MCL]\s*/).filter(Boolean)
      .map(part => part.trim().split(/[\s,]+/).map(Number));
    const [start, curve, end] = parts;
    assert.deepEqual(start, [edge.x1, edge.y1]);
    assert.deepEqual(end, [edge.x2, edge.y2]);
    assert.equal(curve[3], y2);
    assert.equal(curve[5], y2);
    assert.ok(edge.x2 - curve[4] >= 8, 'The curve must flatten before entering the arrow head.');
  }
});

test('horizontal trees preserve ancestry, nonoverlap and stable order across message updates', () => {
  const records = [
    { id: 'root', agent: 'any', createdAt: '1' },
    { id: 'a', agent: 'any', parentId: 'root', createdAt: '2', updatedAt: '9' },
    { id: 'b', agent: 'any', parentId: 'root', createdAt: '3' },
    { id: 'c', agent: 'any', parentId: 'a', createdAt: '4' },
  ];
  const make = items => horizontalTree(selectTree(createIndex(items)));
  const graph = make(records), byId = new Map(graph.nodes.map(item => [item.node.id, item]));
  assert.equal(graph.edges.length, 3);
  for (const edge of graph.edges) assert.ok(edge.x2 > edge.x1);
  assert.ok(byId.get('a').y + byId.get('a').height < byId.get('b').y);
  assert.deepEqual(make(records.map(item => ({ ...item, updatedAt: '20' }))).nodes.map(({ node, x, y }) => [node.id, x, y]),
    graph.nodes.map(({ node, x, y }) => [node.id, x, y]));
  const view = selectTree(createIndex(records));
  assert.deepEqual(horizontalTree(view, { collapsed: new Set(['a']) }).nodes.map(item => item.node.id), ['root', 'a', 'b']);
  assert.equal(horizontalTree(view, { collapsed: new Set(['a']), query: 'c' }).nodes.length, 4);
});
