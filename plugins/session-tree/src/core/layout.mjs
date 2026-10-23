/** Agent-independent, stable left-to-right tree geometry. */
export function horizontalEdgePath({ x1, y1, x2, y2 }) {
  // Keep the arrow entirely on a straight arrival, even for steep branches.
  const arrival = x2 - Math.min(12, Math.max(0, x2 - x1) / 2);
  const mid = (x1 + arrival) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${arrival} ${y2} L ${x2} ${y2}`;
}

export function horizontalTree(view, { collapsed = new Set(), query = '', width = 248, height = 108, gapX = 66, gapY = 24, padding = 28 } = {}) {
  const order = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id);
  const children = new Map(), entries = [], seen = new Set();
  const pending = [...view.roots].sort(order).reverse().map(node => ({ node, depth: 0 }));
  while (pending.length) {
    const item = pending.pop();
    if (seen.has(item.node.id)) continue;
    seen.add(item.node.id);
    const all = [...(view.children.get(item.node.id) || [])].sort(order);
    const folded = !query.trim() && collapsed.has(item.node.id);
    children.set(item.node.id, folded ? [] : all);
    entries.push({ ...item, width, height, hasChildren: all.length > 0, folded });
    if (!folded) for (const node of [...all].reverse()) pending.push({ node, depth: item.depth + 1 });
  }
  const positioned = new Map();
  let leaf = 0;
  for (const item of entries) if (!children.get(item.node.id).length) {
    item.y = padding + leaf++ * (height + gapY);
  }
  for (const item of [...entries].reverse()) {
    const descendants = children.get(item.node.id).map(node => positioned.get(node.id)).filter(Boolean);
    if (descendants.length) item.y = (descendants[0].y + descendants.at(-1).y) / 2;
    item.x = padding + item.depth * (width + gapX);
    positioned.set(item.node.id, item);
  }
  const edges = [];
  for (const item of entries) for (const child of children.get(item.node.id)) {
    const target = positioned.get(child.id);
    if (target) edges.push({ from: item.node.id, to: child.id,
      x1: item.x + width + 12, y1: item.y + height / 2, x2: target.x - 6, y2: target.y + height / 2 });
  }
  return { nodes: entries, edges,
    width: entries.length ? Math.max(...entries.map(item => item.x + width)) + padding : 0,
    height: entries.length ? Math.max(...entries.map(item => item.y + height)) + padding : 0 };
}
