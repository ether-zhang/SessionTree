import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { selectTree } from '../../plugins/session-tree/src/core/tree.mjs';
import { horizontalTree, horizontalEdgePath } from '../../plugins/session-tree/src/core/layout.mjs';
import { panelChoices, panelNodeUrl } from '../../plugins/session-tree/src/ui/codex/panel-model.mjs';
import { messagePreviewLines } from '../../plugins/session-tree/src/ui/codex/conversation-view.mjs';
import { createI18n } from '../../plugins/session-tree/src/ui/codex/i18n.mjs';
import icon from '../../plugins/session-tree/assets/session-tree.svg?raw';
import { useSessionTree } from './useSessionTree';
import type { Geometry, Panel, PositionedNode, SessionNode, View } from './types';

type UI = ReturnType<typeof createI18n>;
const clamp = (scale: number) => Math.max(.2, Math.min(2, scale));

function Heading({ node, active, mode, ui }: { node: SessionNode; active?: boolean; mode: Panel['mode']; ui: UI }) {
  return <span className="node-heading">
    <span className="node-title" dir="auto">{node.missing ? ui.t('none') : node.title}</span>
    {(active || node.archived) && <span className="node-badges">
      {active && <span className="current-badge">{ui.t(mode === 'current' ? 'current' : 'selected')}</span>}
      {node.archived && <span className="archive-badge">{ui.t('archived')}</span>}
    </span>}
  </span>;
}
function Previews({ node, ui }: { node: SessionNode; ui: UI }) {
  const lines = messagePreviewLines(node, ui.t);
  return <span className="node-meta" title={lines.join('\n')}>
    {lines.map((line: string, index: number) => <span className="message-line" key={index}>{line}</span>)}
  </span>;
}
const Card = memo(function Card({ item, active, ancestor, mode, ui, open, toggle }: {
  item: PositionedNode; active: boolean; ancestor: boolean; mode: Panel['mode']; ui: UI;
  open(node: SessionNode): void; toggle(id: string): void;
}) {
  const { node, depth, hasChildren, folded } = item;
  const title = node.missing ? ui.t('none') : node.title;
  const className = 'node' + (active ? ' current' : ancestor ? ' ancestor' : '') +
    (node.contextOnly ? ' context' : '') + (node.archived ? ' archived' : '');
  return <div className="graph-card" role="treeitem" aria-level={depth + 1}
    aria-expanded={hasChildren ? !folded : undefined}
    style={{ left: item.x, top: item.y, width: item.width, height: item.height }}>
    <button type="button" className={className} disabled={!panelNodeUrl(node)} aria-current={active ? 'page' : undefined}
      title={title + '\n' + messagePreviewLines(node, ui.t).join('\n')} onClick={() => open(node)}>
      <span className="node-text"><Heading node={node} active={active} mode={mode} ui={ui}/><Previews node={node} ui={ui}/></span>
    </button>
    {hasChildren && <button type="button" className="collapse" data-node-id={node.id}
      aria-label={ui.t(folded ? 'expand' : 'collapse') + ' ' + title} onClick={() => toggle(node.id)}>{folded ? '+' : '−'}</button>}
  </div>;
});

const Graph = memo(function Graph({ geometry, panel, ui, query, centerRequest, toolbar, onLocate, open, toggle }: {
  geometry: Geometry; panel: Panel; ui: UI; query: string; centerRequest: number;
  toolbar: ReactNode; onLocate(): void;
  open(node: SessionNode): void; toggle(id: string): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const currentView = useRef(view); currentView.current = view;
  const geometryRef = useRef(geometry); geometryRef.current = geometry;
  const currentId = useRef(panel.index.currentId); currentId.current = panel.index.currentId;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const centered = useRef(false), lastRequest = useRef(centerRequest), lastQuery = useRef(query);
  const ancestors = useMemo(() => {
    const result = new Set<string>(), byId = new Map(panel.index.nodes.map(node => [node.id, node]));
    let cursor = panel.index.currentId;
    while (cursor && !result.has(cursor)) { result.add(cursor); cursor = byId.get(cursor)?.parentId || undefined; }
    return result;
  }, [panel.index]);
  function center(item: PositionedNode | undefined, scale = currentView.current.scale) {
    const el = viewport.current;
    if (!el || !item || !el.clientWidth || !el.clientHeight) return;
    scale = clamp(scale);
    setView({ scale, x: el.clientWidth / 2 - (item.x + item.width / 2) * scale, y: el.clientHeight / 2 - (item.y + item.height / 2) * scale });
    centered.current = true;
  }
  function locate() {
    const el = viewport.current, graph = geometryRef.current;
    if (el) center(graph.nodes.find(item => item.node.id === currentId.current) || graph.nodes[0], Math.min(1, (el.clientWidth - 36) / 248));
  }
  function fit() {
    const el = viewport.current;
    if (!el || !geometry.nodes.length) return;
    const scale = Math.max(.2, Math.min(1.2, (el.clientWidth - 16) / geometry.width, (el.clientHeight - 16) / geometry.height));
    setView({ scale, x: (el.clientWidth - geometry.width * scale) / 2, y: (el.clientHeight - geometry.height * scale) / 2 });
  }
  function zoom(factor: number, x?: number, y?: number) {
    const el = viewport.current;
    if (!el) return;
    const old = currentView.current, scale = clamp(old.scale * factor), ratio = scale / old.scale;
    x ??= el.clientWidth / 2; y ??= el.clientHeight / 2;
    setView({ scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  }
  useLayoutEffect(() => {
    if (!centered.current || centerRequest !== lastRequest.current) {
      locate();
      if (!query.trim() || geometry.nodes.some(item => item.node.id === panel.index.currentId)) lastRequest.current = centerRequest;
    }
    else if (query !== lastQuery.current && query.trim()) center(geometry.nodes.find(item => !item.node.contextOnly), Math.min(1, currentView.current.scale));
    lastQuery.current = query;
  }, [geometry, centerRequest, query]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let size: { width: number; height: number } | undefined;
    const resize = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (!next.width || !next.height) return;
      if (!centered.current && geometryRef.current.nodes.length) locate();
      else if (size) setView(old => ({ ...old, x: old.x + (next.width - size!.width) / 2, y: old.y + (next.height - size!.height) / 2 }));
      size = next;
    });
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) { const rect = el.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .006), event.clientX - rect.left, event.clientY - rect.top); }
      else setView(old => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY }));
    };
    resize.observe(el); el.addEventListener('wheel', wheel, { passive: false });
    return () => { resize.disconnect(); el.removeEventListener('wheel', wheel); };
  }, []);
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.id === event.pointerId) setView(old => ({ ...old, x: start.startX + event.clientX - start.x, y: start.startY + event.clientY - start.y }));
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
    if (event.key === '+' || event.key === '=') zoom(1.2);
    if (event.key === '-') zoom(1 / 1.2);
    if (event.key === '0') fit();
    if (event.key === 'Home') onLocate();
    if (event.key.startsWith('Arrow')) setView(old => ({ ...old, x: old.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: old.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }));
  }
  return <>
    <div className="graph-toolbar">{toolbar}<div className="graph-actions">
      <button id="zoom-out" title={ui.t('zoom') + ' −'} aria-label={ui.t('zoom') + ' −'} onClick={() => zoom(1 / 1.2)}>−</button>
      <span id="zoom-value" dir="ltr">{ui.percent(view.scale)}</span>
      <button id="zoom-in" title={ui.t('zoom') + ' +'} aria-label={ui.t('zoom') + ' +'} onClick={() => zoom(1.2)}>＋</button>
      <button id="fit" title={ui.t('fit')} onClick={fit}>{ui.t('fit')}</button>
      <button id="locate" title={ui.t('locate')} onClick={onLocate}>{ui.t('locate')}</button>
    </div></div>
    <div ref={viewport} id="viewport" tabIndex={0} aria-label={ui.t('title')} hidden={!geometry.nodes.length}
      className={'viewport' + (dragging ? ' dragging' : '')} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }} onKeyDown={keyboard}>
      <div id="world" className="world" style={{ width: geometry.width, height: geometry.height, transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')' }}>
        <svg id="edges" className="edges" width={geometry.width} height={geometry.height} aria-hidden="true">
          <defs>{[['arrow', 'var(--edge)'], ['arrow-active', 'var(--accent)']].map(([id, color]) =>
            <marker key={id} id={id} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M 2 1.5 L 6 4 L 2 6.5" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </marker>)}</defs>
          {geometry.edges.map(edge => {
            const active = ancestors.has(edge.from) && ancestors.has(edge.to);
            return <path key={edge.from + ':' + edge.to} className={'edge' + (active ? ' active' : '')} d={horizontalEdgePath(edge)} markerEnd={'url(#' + (active ? 'arrow-active' : 'arrow') + ')'}/>;
          })}
        </svg>
        <div id="tree" role="tree" aria-label={ui.t('title')}>
          {geometry.nodes.map(item => <Card key={item.node.id} item={item} active={item.node.id === panel.index.currentId} ancestor={ancestors.has(item.node.id)} mode={panel.mode} ui={ui} open={open} toggle={toggle}/>)}
        </div>
      </div>
    </div>
    <p id="empty" className="note" hidden={!!geometry.nodes.length}>{ui.t('none')}</p>
  </>;
});

export function SessionTreeApp() {
  const state = useSessionTree(), ui = useMemo(() => createI18n(state.locale), [state.locale]);
  const [query, setQuery] = useState(''), deferredQuery = useDeferredValue(query);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [centerRequest, setCenterRequest] = useState(0);
  const panel = state.panel;
  const geometry = useMemo(() => panel && panel.mode !== 'choose'
    ? horizontalTree(selectTree(panel.index, { query: deferredQuery, archived: true }), { collapsed, query: deferredQuery }) as Geometry : null,
  [panel, deferredQuery, collapsed]);
  useEffect(() => { setCollapsed(new Set()); setQuery(''); setCenterRequest(value => value + 1); }, [state.familyEpoch]);
  useEffect(() => {
    document.documentElement.lang = ui.lang; document.documentElement.dir = ui.dir; document.title = ui.t('title');
  }, [ui]);
  useEffect(() => { if (state.theme) document.documentElement.dataset.theme = state.theme; }, [state.theme]);
  const toggle = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  const locate = useCallback(() => {
    if (!panel) return;
    const byId = new Map(panel.index.nodes.map(node => [node.id, node])), seen = new Set<string>();
    let id = panel.index.currentId;
    while (id && !seen.has(id)) { seen.add(id); id = byId.get(id)?.parentId || undefined; }
    setCollapsed(previous => {
      const next = new Set(previous);
      for (const ancestor of seen) next.delete(ancestor);
      return next;
    });
    setQuery(''); setCenterRequest(value => value + 1);
  }, [panel]);
  const choices = panel?.mode === 'choose' ? panelChoices(panel.index, deferredQuery) as SessionNode[] : [];
  const count = panel?.index.nodes.filter(node => !node.missing).length || 0;
  const toolbar = useMemo(() => panel?.mode === 'selected'
    ? <button id="choose-again" className="caption choose-again" title={ui.t('choose')} aria-label={ui.t('choose')} onClick={() => { setQuery(''); state.select(); }}>{ui.count(count)} ⌄</button>
    : <span id="count" className="caption" title={ui.count(count)}>{ui.count(count)}</span>,
  [panel?.mode, count, ui, state.select]);
  return <>
    <header className="panel-heading">
      <span className="tree-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }}/>
      <h1 id="heading" title={ui.t('title')}>{ui.t('title')}</h1>
      <label className="search"><span aria-hidden="true">⌕</span><input id="search" type="search" dir="auto" value={query}
        placeholder={ui.t('search')} aria-label={ui.t('search')} onChange={event => setQuery(event.target.value)}/></label>
      <button id="refresh" className="icon-button" title={ui.t('refresh')} aria-label={ui.t('refresh')} disabled={state.loading} onClick={state.refresh}>↻</button>
    </header>
    <div id="status" className={'status' + (state.status.error ? ' error' : '')} role="status" aria-live="polite"
      hidden={!state.status.key} title={state.status.detail}>{state.status.key ? ui.t(state.status.key) : ''}</div>
    <main>
      {panel?.mode === 'choose' && <section id="picker" hidden={state.transitioning}>
        <p id="picker-note" className="note">{ui.t(choices.length ? 'choose' : 'none')}</p>
        <p id="choice-count" className="caption">{choices.length > 50 ? '50 / ' + ui.count(choices.length) : ui.count(choices.length)}</p>
        <div id="choices" className="choices" aria-label={ui.t('choose')}>{choices.slice(0, 50).map(node =>
          <button key={node.id} type="button" className={'choice' + (node.archived ? ' archived' : '')} disabled={!!node.archived} onClick={() => state.select(node.nativeId)}>
            <Heading node={node} mode="choose" ui={ui}/><Previews node={node} ui={ui}/>
          </button>)}</div>
      </section>}
      {panel && geometry && <section id="family" aria-label={ui.t('title')} hidden={state.transitioning}>
        <Graph key={state.familyEpoch} geometry={geometry} panel={panel} ui={ui} query={deferredQuery} centerRequest={centerRequest} open={state.open} toggle={toggle} onLocate={locate}
          toolbar={toolbar}/>
      </section>}
    </main>
  </>;
}
