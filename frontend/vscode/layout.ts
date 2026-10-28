import { horizontalTree } from '../../plugins/session-tree/src/core/layout.mjs';
export { horizontalEdgePath as edgePath } from '../../plugins/session-tree/src/core/layout.mjs';
import type { SessionNode } from '../../extensions/vscode/src/types';

export interface BoxNode { node: SessionNode; x: number; y: number; width: number; height: number; depth: number }
export interface BoxEdge { from: string; to: string; x1: number; y1: number; x2: number; y2: number }
export interface BoxGraph { nodes: BoxNode[]; edges: BoxEdge[]; width: number; height: number }

/** Reuse the common left-to-right tree layout with compact, fixed-size title boxes. */
export function boxTree(records: readonly SessionNode[]): BoxGraph {
  const byId = new Map(records.map(node => [node.id, node]));
  const children = new Map<string, SessionNode[]>();
  const roots = records.filter(node => !node.parentId || !byId.has(node.parentId));
  for (const node of records) if (node.parentId && byId.has(node.parentId)) {
    const list = children.get(node.parentId) ?? []; list.push(node); children.set(node.parentId, list);
  }
  return horizontalTree({ roots, children }, { width: 120, height: 32, gapX: 40, gapY: 18, padding: 20 }) as unknown as BoxGraph;
}
