import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PointerEvent } from 'react';
import { fitCamera, zoomCamera } from '../../extensions/vscode/src/graph-layout';
import type { Camera } from '../../extensions/vscode/src/graph-layout';
import type { FirstReply, GraphSnapshot } from '../../extensions/vscode/src/types';
import { boxTree, edgePath } from './layout';
import { SessionList } from './list';
import type { ListState } from './list';
import './graph.css';

interface SavedView { selectedId: string | null; camera: Camera; layout: 'compact-lr-v3'; list?: ListState }
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): SavedView | undefined; setState(value: SavedView): void };
const host = acquireVsCodeApi();

function Graph() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 12, y: 36, scale: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null), [focused, setFocused] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [popup, setPopup] = useState<{ id: string; reply?: FirstReply } | null>(null);
  const popupElement = useRef<HTMLDivElement>(null);
  const [popupHeight, setPopupHeight] = useState(64);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewCache = useRef(new Map<string, { stamp: string; reply: FirstReply; at: number }>());
  const requests = useRef(new Map<string, { requestId: number; stamp: string; treeId: string }>());
  const nextRequest = useRef(0), currentSnapshot = useRef(snapshot), currentHovered = useRef(hovered);
  currentSnapshot.current = snapshot; currentHovered.current = hovered;
  const shell = useRef<HTMLElement>(null), viewport = useRef<SVGSVGElement>(null), currentCamera = useRef(camera);
  currentCamera.current = camera;
  const initialState = useRef(host.getState()), selected = useRef<string | null | undefined>(undefined);
  const listState = useRef<ListState>(initialState.current?.list ?? { scrollTop: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; start: Camera; moved: boolean; nodeId?: string } | null>(null);
  const inTree = Boolean(snapshot?.selectedId);
  const graph = useMemo(() => boxTree(snapshot?.selectedId ? snapshot.nodes : []), [snapshot]);
  const byId = useMemo(() => new Map(graph.nodes.map(item => [item.node.id, item])), [graph]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'snapshot' && Array.isArray(data.nodes) && data.labels) setSnapshot(data);
      else if (data?.type === 'firstReply' && data.treeId === currentSnapshot.current?.selectedId) {
        const pending = requests.current.get(data.nodeId);
        if (!pending || pending.requestId !== data.requestId || pending.treeId !== data.treeId) return;
        requests.current.delete(data.nodeId);
        const reply: FirstReply = ['available', 'empty', 'limited', 'unavailable'].includes(data.preview?.status)
          && (data.preview.status !== 'available' || typeof data.preview.text === 'string') ? data.preview : { status: 'unavailable' };
        if (previewCache.current.size >= 64 && !previewCache.current.has(data.nodeId)) {
          const oldest = previewCache.current.keys().next().value;
          if (oldest !== undefined) previewCache.current.delete(oldest);
        }
        previewCache.current.set(data.nodeId, { stamp: pending.stamp, reply, at: Date.now() });
        if (currentHovered.current === data.nodeId) setPopup({ id: data.nodeId, reply });
      }
    };
    window.addEventListener('message', receive);
    const visible = () => { if (!document.hidden) host.postMessage({ type: 'ready' }); };
    document.addEventListener('visibilitychange', visible);
    host.postMessage({ type: 'ready' });
    return () => { clearTimeout(closeTimer.current); window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visible); };
  }, []);

  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const resize = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize(old => old.width === next.width && old.height === next.height ? old : next);
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el || !inTree) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setHovered(null); setPopup(null);
      const rect = el.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      setCamera(old => zoomCamera(old, Math.exp(-Math.max(-200, Math.min(200, delta)) * .004), event.clientX - rect.left, event.clientY - rect.top));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [inTree]);

  useLayoutEffect(() => {
    if (!snapshot?.selectedId) { selected.current = undefined; return; }
    if (!graph.nodes.length || !size.width || !size.height || selected.current === snapshot.selectedId) return;
    const saved = initialState.current;
    const restored = saved?.layout === 'compact-lr-v3' && saved.selectedId === snapshot.selectedId && saved.camera && Number.isFinite(saved.camera.x)
      && Number.isFinite(saved.camera.y) && saved.camera.scale >= .05 && saved.camera.scale <= 2.5;
    const anchor = byId.get(snapshot.selectedId ?? '') ?? graph.nodes[0];
    const scale = Math.min(1, (size.width - 24) / anchor.width);
    setCamera(restored ? saved!.camera : { scale, x: size.width / 2 - (anchor.x + anchor.width / 2) * scale,
      y: Math.min(40, size.height / 2 - (anchor.y + anchor.height / 2) * scale) });
    previewCache.current.clear(); requests.current.clear(); setPopup(null);
    selected.current = snapshot.selectedId; setFocused(null); setHovered(null);
    viewport.current?.focus({ preventScroll: true });
  }, [snapshot, graph, size]);

  useEffect(() => {
    if (!snapshot?.selectedId || selected.current !== snapshot.selectedId) return;
    const timer = setTimeout(() => {
      const state: SavedView = { selectedId: snapshot.selectedId, camera, layout: 'compact-lr-v3', list: listState.current };
      initialState.current = state; host.setState(state);
    }, 180);
    return () => clearTimeout(timer);
  }, [camera, snapshot]);

  const hoverStamp = byId.get(hovered ?? '')?.node.updatedAt ?? byId.get(hovered ?? '')?.node.createdAt ?? '';
  useEffect(() => {
    if (!hovered || !snapshot?.selectedId || dragging || !byId.has(hovered)) { setPopup(null); return; }
    const treeId = snapshot.selectedId;
    const timer = setTimeout(() => {
      const node = byId.get(hovered)?.node;
      if (!node?.nativeId || node.missing) { setPopup({ id: hovered, reply: { status: 'unavailable' } }); return; }
      const cached = previewCache.current.get(hovered);
      if (cached && (cached.reply.status === 'available' || cached.stamp === hoverStamp && Date.now() - cached.at < 5000)) {
        setPopup({ id: hovered, reply: cached.reply }); return;
      }
      setPopup({ id: hovered });
      if (requests.current.has(hovered)) return;
      const requestId = ++nextRequest.current;
      requests.current.set(hovered, { requestId, stamp: hoverStamp, treeId });
      host.postMessage({ type: 'preview', treeId, nodeId: hovered, requestId });
    }, 220);
    return () => clearTimeout(timer);
  }, [hovered, hoverStamp, snapshot?.selectedId, dragging, byId]);

  useLayoutEffect(() => {
    const height = popupElement.current?.getBoundingClientRect().height;
    if (height) setPopupHeight(old => Math.abs(old - height) > 1 ? height : old);
  }, [popup, size.width, size.height, camera.x, camera.y]);

  function enterNode(id: string) { clearTimeout(closeTimer.current); setHovered(id); }
  function leaveNode() { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setHovered(null), 120); }

  function locate(item = byId.get(snapshot?.selectedId ?? '')) {
    if (!item) return;
    const scale = Math.min(1.1, Math.max(.9, currentCamera.current.scale));
    setCamera({ scale, x: size.width / 2 - (item.x + item.width / 2) * scale,
      y: size.height / 2 - (item.y + item.height / 2) * scale });
    setFocused(item.node.id);
  }
  function fit() { setCamera(fitCamera(graph, size.width, size.height)); setFocused(null); setHovered(null); setPopup(null); }
  function zoom(factor: number) { setHovered(null); setPopup(null); setCamera(old => zoomCamera(old, factor, size.width / 2, size.height / 2)); }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    clearTimeout(closeTimer.current); setHovered(null); setPopup(null);
    event.currentTarget.focus({ preventScroll: true });
    const nodeId = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? undefined;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: currentCamera.current, moved: false, nodeId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
    if (start.moved) { setDragging(true); setCamera({ ...start.start, x: start.start.x + dx, y: start.start.y + dy }); }
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const start = drag.current; drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (start && !start.moved) {
      const item = start.nodeId ? byId.get(start.nodeId) : undefined;
      if (item && !item.node.archived && !item.node.missing) openConversation(item.node.id);
      else if (!item) setFocused(null);
    }
  }
  function openConversation(nodeId: string) {
    setFocused(nodeId);
    host.postMessage({ type: 'openConversation', treeId: snapshot?.selectedId, nodeId });
  }
  const labels = snapshot?.labels;
  const bounds = { left: -camera.x / camera.scale - 80, top: -camera.y / camera.scale - 80,
    right: (size.width - camera.x) / camera.scale + 80, bottom: (size.height - camera.y) / camera.scale + 80 };
  const visibleNodes = graph.nodes.filter(item => item.x + item.width >= bounds.left && item.x <= bounds.right
    && item.y + item.height >= bounds.top && item.y <= bounds.bottom);
  const visibleEdges = graph.edges.filter(edge => Math.max(edge.x1, edge.x2) >= bounds.left && Math.min(edge.x1, edge.x2) <= bounds.right
    && Math.max(edge.y1, edge.y2) >= bounds.top && Math.min(edge.y1, edge.y2) <= bounds.bottom);
  const popupNode = popup ? byId.get(popup.id) : undefined;
  const popupWidth = Math.max(80, Math.min(300, size.width - 16));
  const popupX = popupNode ? Math.max(8, Math.min(size.width - popupWidth - 8, camera.x + (popupNode.x + popupNode.width / 2) * camera.scale - popupWidth / 2)) : 8;
  const below = popupNode ? camera.y + (popupNode.y + popupNode.height) * camera.scale + 8 : 8;
  const popupMaxHeight = popupNode ? Math.max(48, Math.min(80, size.height - 16,
    Math.max(camera.y + popupNode.y * camera.scale - 16, size.height - below - 8))) : 80;
  const popupY = Math.max(8, Math.min(size.height - popupHeight - 8, below + popupHeight <= size.height - 8 ? below
    : popupNode ? camera.y + popupNode.y * camera.scale - popupHeight - 8 : 8));
  return <main ref={shell} className="graph-shell">
    {snapshot && !inTree ? <SessionList snapshot={snapshot} height={size.height} state={listState.current}
      remember={state => { listState.current = state; }} open={nodeId => host.postMessage({ type: 'openTree', nodeId })}/> : <>
    <svg ref={viewport} className={'graph-viewport' + (dragging ? ' dragging' : '')} tabIndex={0}
      aria-label={labels?.title ?? 'Conversation graph'} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(1.2);
        if (event.key === '-') zoom(1 / 1.2);
        if (event.key === '0') fit();
        if (event.key === 'Home') locate();
        if (event.key.startsWith('Arrow')) setCamera(old => ({ ...old,
          x: old.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0),
          y: old.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }));
      }}>
      <defs><marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4"
        markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M 1 1 L 6 4 L 1 7" className="edge-arrow"/></marker></defs>
      <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>
        {visibleEdges.map(edge => <path key={edge.from + ':' + edge.to} d={edgePath(edge)} className="tree-edge" markerEnd="url(#arrow)"/>) }
        {visibleNodes.map(item => {
          const node = item.node, anchor = node.id === snapshot?.selectedId;
          return <g key={node.id} data-node-id={node.id} className={'graph-node' + (anchor ? ' anchor' : '')
            + (node.id === hovered || node.id === focused ? ' focused' : '') + (node.archived || node.missing ? ' muted' : '')}
            tabIndex={node.archived || node.missing ? -1 : 0} role="treeitem" aria-label={node.title} aria-current={anchor ? 'true' : undefined}
            aria-disabled={node.archived || node.missing || undefined}
            data-vscode-context={JSON.stringify({ webviewSection: 'session-tree-node', sessionTreeNodeId: node.id, preventDefaultContextMenuItems: true })}
            onFocus={() => { setFocused(node.id); enterNode(node.id); }} onBlur={leaveNode}
            onPointerEnter={() => { if (!drag.current) enterNode(node.id); }} onPointerLeave={leaveNode}
            onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !node.archived && !node.missing) { event.preventDefault(); openConversation(node.id); } }}>
            <rect x={item.x} y={item.y} width={item.width} height={item.height} rx={3} className="card-frame"
              strokeDasharray={node.archived || node.missing ? '4 3' : undefined}/>
            <foreignObject x={item.x + 8} y={item.y + 5} width={item.width - 16} height={22}>
              <div className="node-caption">
                {node.archived && <svg className="archive-icon" viewBox="0 0 16 16" aria-label={labels?.archived}><path d="M2 2h12v3H2zM3 5v9h10V5M6 8h4"/></svg>}
                <span className="node-title">{node.missing ? labels?.missing : node.title}</span>
              </div>
            </foreignObject>
          </g>;
        })}
      </g>
    </svg>
    {popup && popupNode && labels && <div ref={popupElement} className="reply-preview" role="tooltip" aria-label={popupNode.node.title} aria-busy={!popup.reply}
      style={{ left: popupX, top: popupY, width: popupWidth, maxHeight: popupMaxHeight }}
      onPointerEnter={() => clearTimeout(closeTimer.current)} onPointerLeave={() => setHovered(null)}>
      <div className="reply-row"><span className="reply-speaker">{labels.user}：</span>
        <span className={'reply-text' + (popup.reply?.user ? '' : ' reply-status')}>{popup.reply?.user || (!popup.reply ? '…' : labels.emptyUser)}</span></div>
      <div className="reply-row"><span className="reply-speaker">{snapshot?.agentLabel}：</span>
        <span className={'reply-text' + (popup.reply?.status === 'available' ? '' : ' reply-status')}>
          {!popup.reply ? labels.loadingReply : popup.reply.status === 'available' ? popup.reply.text
            : popup.reply.status === 'empty' ? labels.emptyReply : popup.reply.status === 'limited' ? labels.limitedReply : labels.unavailableReply}
        </span></div>
    </div>}
    {labels && graph.nodes.length > 0 && <div className="canvas-tools">
      <button title={labels.zoomOut} aria-label={labels.zoomOut} onClick={() => zoom(1 / 1.2)}>−</button>
      <span className="zoom-value">{Math.round(camera.scale * 100)}%</span>
      <button title={labels.zoomIn} aria-label={labels.zoomIn} onClick={() => zoom(1.2)}>+</button>
      <button title={labels.fit} aria-label={labels.fit} onClick={fit}><svg width="14" height="14" viewBox="0 0 16 16"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"/></svg></button>
      <button title={labels.locate} aria-label={labels.locate} onClick={() => locate()}><svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/><path d="M8 0v4m0 8v4M0 8h4m8 0h4"/></svg></button>
    </div>}
    {snapshot && (!graph.nodes.length || snapshot.message) && <p className="empty">{snapshot.message}</p>}
    </>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Graph/>);
