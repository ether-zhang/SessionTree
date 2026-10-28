import { useLayoutEffect, useRef, useState } from 'react';
import type { GraphSnapshot } from '../../extensions/vscode/src/types';

export interface ListState { scrollTop: number; focusedId?: string }
const rowHeight = 22;

/** A flat, virtualized list in the same view that hosts the second-level canvas. */
export function SessionList({ snapshot, height, state, remember, open }: {
  snapshot: GraphSnapshot; height: number; state: ListState; remember(state: ListState): void; open(id: string): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(state.scrollTop);
  const [focusedId, setFocusedId] = useState(state.focusedId ?? snapshot.nodes[0]?.id);
  const nodes = snapshot.nodes;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const last = Math.min(nodes.length, first + Math.ceil(height / rowHeight) + 9);

  useLayoutEffect(() => {
    if (!element.current) return;
    element.current.scrollTop = state.scrollTop;
    element.current.focus({ preventScroll: true });
  }, []);

  function focus(index: number) {
    const item = nodes[Math.max(0, Math.min(nodes.length - 1, index))], el = element.current;
    if (!item || !el) return;
    setFocusedId(item.id);
    const top = nodes.indexOf(item) * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    remember({ scrollTop: el.scrollTop, focusedId: item.id });
  }

  return <div className="session-list-shell">
    {snapshot.message && <p className="list-message" role="status">{snapshot.message}</p>}
    <div ref={element} className="session-list" role="listbox" tabIndex={0} aria-label={snapshot.labels.listTitle}
      aria-activedescendant={nodes.slice(first, last).some(node => node.id === focusedId) ? 'session-' + focusedId : undefined}
      onScroll={event => { const top = event.currentTarget.scrollTop; setScrollTop(top); remember({ scrollTop: top, focusedId }); }}
      onKeyDown={event => {
        const index = nodes.findIndex(node => node.id === focusedId);
        if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(event.key)) event.preventDefault();
        if (event.key === 'ArrowUp') focus(index - 1);
        if (event.key === 'ArrowDown') focus(index + 1);
        if (event.key === 'Home') focus(0);
        if (event.key === 'End') focus(nodes.length - 1);
        if (event.key === 'PageUp' || event.key === 'PageDown') focus(index + Math.floor(height / rowHeight) * (event.key === 'PageUp' ? -1 : 1));
        if ((event.key === 'Enter' || event.key === ' ') && index >= 0 && !nodes[index].archived) open(nodes[index].id);
      }}>
      <div className="session-list-content" style={{ height: nodes.length * rowHeight }}>
        {nodes.slice(first, last).map((node, offset) => {
          const date = new Date(node.updatedAt ?? node.createdAt ?? '');
          const title = [node.title, node.archived ? snapshot.labels.archived : '', node.workspace,
            Number.isFinite(date.getTime()) ? snapshot.labels.updated + ': ' + date.toLocaleString(snapshot.locale) : '', node.nativeId].filter(Boolean).join('\n');
          return <div key={node.id} id={'session-' + node.id} data-session-id={node.id} role="option" aria-selected={node.id === focusedId}
            aria-disabled={node.archived || undefined} className={'session-option' + (node.id === focusedId ? ' focused' : '') + (node.archived ? ' archived' : '')}
            style={{ top: (first + offset) * rowHeight }} title={title}
            data-vscode-context={JSON.stringify({ webviewSection: 'session-tree-node', sessionTreeNodeId: node.id, preventDefaultContextMenuItems: true })}
            onClick={() => { setFocusedId(node.id); remember({ scrollTop, focusedId: node.id }); if (!node.archived) open(node.id); }}>
            {node.archived && <svg className="archive-icon" viewBox="0 0 16 16" aria-label={snapshot.labels.archived}><path d="M2 2h12v3H2zM3 5v9h10V5M6 8h4"/></svg>}
            <span>{node.title.replace(/[\r\n\t]/g, ' ')}</span>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
