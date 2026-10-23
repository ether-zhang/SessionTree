import { selectTree } from '../../core/tree.mjs';
import { horizontalTree, horizontalEdgePath } from '../../core/layout.mjs';
import { panelChoices, panelNodeUrl } from './panel-model.mjs';
import { AppBridge, dataLoadError } from './transport.mjs';
import { messagePreviewLines } from './conversation-view.mjs';
import { createI18n, canonicalUiLocale } from './i18n.mjs';

const $ = id => document.getElementById(id), bridge = new AppBridge(window, { displayModes: ['fullscreen'] });
let panel, selectedThreadId, epoch = 0, stopped = false, navigating = false, loading = false;
let collapsed = new Set(), geometry, view = { x: 0, y: 0, scale: 1 }, needsCenter = true;
let timer, searchTimer, delay = 12000, drag, inView = true;
let clientLocale, appliedLocale, ui = createI18n(window.openai?.locale || navigator.language);
let statusKey = '', statusError = false, statusDetail = '';
function applyLocale(context = {}, renderView = true) {
  const declared = canonicalUiLocale(context?.locale);
  if (declared) clientLocale = declared;
  const requested = canonicalUiLocale(clientLocale || window.openai?.locale || bridge.locale || navigator.language) || 'en';
  if (requested === appliedLocale) return false;
  const next = createI18n(requested);
  const changed = next.lang !== ui.lang;
  ui = next;
  appliedLocale = requested;
  document.documentElement.lang = ui.lang; document.documentElement.dir = ui.dir;
  document.title = ui.t('title'); $('heading').textContent = ui.t('title'); $('heading').title = ui.t('title');
  $('search').placeholder = ui.t('search'); $('search').setAttribute('aria-label', ui.t('search'));
  for (const [id, key] of [['refresh', 'refresh'], ['fit', 'fit'], ['locate', 'locate'], ['choose-again', 'choose']]) {
    $(id).title = ui.t(key); $(id).setAttribute('aria-label', ui.t(key));
  }
  $('fit').textContent = ui.t('fit'); $('locate').textContent = ui.t('locate');
  for (const [id, sign] of [['zoom-in', '+'], ['zoom-out', '−']]) {
    $(id).title = ui.t('zoom') + ' ' + sign; $(id).setAttribute('aria-label', $(id).title);
  }
  for (const id of ['family', 'viewport', 'tree']) $(id).setAttribute('aria-label', ui.t('title'));
  $('choices').setAttribute('aria-label', ui.t('choose'));
  status(statusKey, statusError, statusDetail);
  if (changed && panel && renderView) render();
  return changed;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function previews(node) {
  const group = element('span', 'node-meta'), lines = messagePreviewLines(node, ui.t);
  group.title = lines.join('\n');
  for (const line of lines) group.append(element('span', 'message-line', line));
  return group;
}
function nodeHeading(node, active = false) {
  const group = element('span', 'node-heading'), badges = element('span', 'node-badges');
  const title = element('span', 'node-title', node.missing ? ui.t('none') : node.title);
  title.dir = 'auto'; group.append(title);
  if (active) badges.append(element('span', 'current-badge', ui.t(panel.mode === 'current' ? 'current' : 'selected')));
  if (node.archived) badges.append(element('span', 'archive-badge', ui.t('archived')));
  if (badges.childElementCount) group.append(badges);
  return group;
}
function status(key = '', error = false, detail = '') {
  statusKey = key; statusError = error; statusDetail = detail;
  $('status').textContent = key ? ui.t(key) : '';
  $('status').title = detail;
  $('status').hidden = !key;
  $('status').classList.toggle('error', error);
}
function theme(context) {
  if (['light', 'dark'].includes(context?.theme)) document.documentElement.dataset.theme = context.theme;
}
function schedule() {
  clearTimeout(timer);
  if (!stopped && !bridge.closed && !document.hidden && inView) {
    timer = setTimeout(() => load({ background: true }), delay);
  }
}
async function load({ refresh = false, background = false, context = false } = {}) {
  if (stopped || bridge.closed || (loading && background)) return;
  clearTimeout(timer);
  const ticket = ++epoch, previous = panel;
  loading = true;
  if (context || !previous) {
    panel = null; $('family').hidden = true; $('picker').hidden = true;
    status('loading');
  } else if (!background) status('loading');
  $('refresh').disabled = true;
  try {
    const next = await bridge.loadPanel({ refresh, currentThreadId: selectedThreadId, check: context });
    if (stopped || ticket !== epoch) return;
    const languageChanged = applyLocale({}, false);
    const different = previous?.nativeId !== next.nativeId || previous?.index.rootId !== next.index.rootId;
    if (different) { collapsed.clear(); $('search').value = ''; needsCenter = true; }
    panel = next;
    status();
    if (next !== previous || context || refresh || languageChanged) render();
    delay = next === previous ? Math.min(30000, delay * 1.5) : 12000;
  } catch (error) {
    if (ticket === epoch && !stopped) {
      status('error', true, dataLoadError(error));
      delay = Math.min(60000, delay * 2);
    }
  } finally {
    if (ticket === epoch && !stopped) { loading = false; $('refresh').disabled = false; schedule(); }
  }
}

function applyView() {
  $('world').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
  $('zoom-value').textContent = ui.percent(view.scale);
}
function centerItem(item, scale = view.scale) {
  if (!item) return;
  view.scale = Math.max(.2, Math.min(2, scale));
  view.x = $('viewport').clientWidth / 2 - (item.x + item.width / 2) * view.scale;
  view.y = $('viewport').clientHeight / 2 - (item.y + item.height / 2) * view.scale;
  applyView();
}
function locate() {
  if (!geometry) return;
  if (!geometry.nodes.some(item => item.node.id === panel.index.currentId)) {
    const byId = new Map(panel.index.nodes.map(node => [node.id, node]));
    let id = panel.index.currentId;
    const visited = new Set();
    while (id && !visited.has(id)) { visited.add(id); collapsed.delete(id); id = byId.get(id)?.parentId; }
    $('search').value = ''; render();
  }
  const item = geometry.nodes.find(item => item.node.id === panel.index.currentId) || geometry.nodes[0];
  centerItem(item, Math.min(1, ($('viewport').clientWidth - 36) / 248));
}
function fit() {
  if (!geometry?.nodes.length) return;
  view.scale = Math.max(.2, Math.min(1.2, ($('viewport').clientWidth - 16) / geometry.width, ($('viewport').clientHeight - 16) / geometry.height));
  view.x = ($('viewport').clientWidth - geometry.width * view.scale) / 2;
  view.y = ($('viewport').clientHeight - geometry.height * view.scale) / 2;
  applyView();
}
function zoom(factor, x = $('viewport').clientWidth / 2, y = $('viewport').clientHeight / 2) {
  const scale = Math.max(.2, Math.min(2, view.scale * factor)), ratio = scale / view.scale;
  view.x = x - (x - view.x) * ratio; view.y = y - (y - view.y) * ratio; view.scale = scale;
  applyView();
}
function svg(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
async function openNode(node) {
  const url = panelNodeUrl(node);
  if (navigating || !url || stopped) return;
  navigating = true;
  const ticket = epoch;
  status('loading');
  try { await bridge.openThread(url); if (ticket === epoch && !stopped) status(); }
  catch (error) { if (ticket === epoch && !stopped) status('error', true, error.message); }
  finally { navigating = false; }
}

function render() {
  if (!panel) return;
  const choose = panel.mode === 'choose', query = $('search').value;
  $('picker').hidden = !choose; $('family').hidden = choose;
  $('choose-again').hidden = panel.mode !== 'selected';
  $('count').hidden = panel.mode === 'selected';
  $('search').placeholder = ui.t('search');
  if (choose) {
    const choices = panelChoices(panel.index, query);
    $('choice-count').textContent = choices.length > 50 ? '50 / ' + ui.count(choices.length) : ui.count(choices.length);
    $('choices').replaceChildren();
    for (const node of choices.slice(0, 50)) {
      const button = element('button', 'choice' + (node.archived ? ' archived' : ''));
      button.type = 'button'; button.append(nodeHeading(node), previews(node));
      if (node.archived) button.disabled = true;
      button.onclick = () => { selectedThreadId = node.nativeId; needsCenter = true; load({ context: true }); };
      $('choices').append(button);
    }
    $('picker-note').textContent = ui.t(choices.length ? 'choose' : 'none');
    return;
  }
  const count = panel.index.nodes.filter(node => !node.missing).length;
  $('count').textContent = ui.count(count); $('count').title = ui.count(count);
  $('choose-again').textContent = ui.count(count) + ' ⌄';
  const filtered = selectTree(panel.index, { query, archived: true });
  geometry = horizontalTree(filtered, { collapsed, query });
  const ancestors = new Set(), byId = new Map(panel.index.nodes.map(node => [node.id, node]));
  let cursor = panel.index.currentId;
  while (cursor && !ancestors.has(cursor)) { ancestors.add(cursor); cursor = byId.get(cursor)?.parentId; }
  $('tree').replaceChildren(); $('edges').replaceChildren();
  $('world').style.width = geometry.width + 'px'; $('world').style.height = geometry.height + 'px';
  $('edges').setAttribute('width', geometry.width); $('edges').setAttribute('height', geometry.height);
  const defs = svg('defs', {});
  for (const [id, color] of [['arrow', 'var(--edge)'], ['arrow-active', 'var(--accent)']]) {
    const marker = svg('marker', { id, viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto' });
    marker.append(svg('path', { d: 'M 2 1.5 L 6 4 L 2 6.5', fill: 'none', stroke: color,
      'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); defs.append(marker);
  }
  $('edges').append(defs);
  for (const edge of geometry.edges) {
    const active = ancestors.has(edge.from) && ancestors.has(edge.to);
    $('edges').append(svg('path', { class: 'edge' + (active ? ' active' : ''),
      d: horizontalEdgePath(edge),
      'marker-end': 'url(#' + (active ? 'arrow-active' : 'arrow') + ')' }));
  }
  for (const item of geometry.nodes) {
    const { node, depth, hasChildren, folded } = item, active = node.id === panel.index.currentId;
    const title = node.missing ? ui.t('none') : node.title;
    const card = element('div', 'graph-card');
    card.style.cssText = 'left:' + item.x + 'px;top:' + item.y + 'px;width:' + item.width + 'px;height:' + item.height + 'px';
    card.setAttribute('role', 'treeitem'); card.setAttribute('aria-level', depth + 1);
    if (hasChildren) card.setAttribute('aria-expanded', String(!folded));
    const button = element('button', 'node' + (active ? ' current' : ancestors.has(node.id) ? ' ancestor' : '') + (node.contextOnly ? ' context' : ''));
    if (node.archived) button.classList.add('archived');
    button.type = 'button'; button.disabled = !panelNodeUrl(node); button.title = title + '\n' + messagePreviewLines(node, ui.t).join('\n');
    if (active) button.setAttribute('aria-current', 'page');
    const text = element('span', 'node-text');
    text.append(nodeHeading(node, active), previews(node)); button.append(text);
    button.onclick = () => openNode(node); card.append(button);
    if (hasChildren) {
      const toggle = element('button', 'collapse', folded ? '+' : '−');
      toggle.type = 'button'; toggle.setAttribute('aria-label', ui.t(folded ? 'expand' : 'collapse') + ' ' + title);
      toggle.dataset.nodeId = node.id;
      toggle.onclick = () => {
        collapsed.has(node.id) ? collapsed.delete(node.id) : collapsed.add(node.id);
        render();
        [...$('tree').querySelectorAll('.collapse')].find(el => el.dataset.nodeId === node.id)?.focus();
      };
      card.append(toggle);
    }
    $('tree').append(card);
  }
  $('empty').hidden = geometry.nodes.length > 0;
  $('empty').textContent = ui.t('none');
  $('viewport').hidden = !geometry.nodes.length;
  if (needsCenter && geometry.nodes.length) { needsCenter = false; requestAnimationFrame(locate); }
  else applyView();
}

$('search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    render();
    if ($('search').value.trim()) centerItem(geometry?.nodes.find(item => !item.node.contextOnly), Math.min(1, view.scale));
  }, 150);
};
$('refresh').onclick = () => load({ refresh: true });
$('choose-again').onclick = () => { selectedThreadId = undefined; $('search').value = ''; load({ context: true }); };
$('zoom-in').onclick = () => zoom(1.2); $('zoom-out').onclick = () => zoom(1 / 1.2);
$('fit').onclick = fit; $('locate').onclick = locate;
$('viewport').addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = $('viewport').getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * .006), event.clientX - rect.left, event.clientY - rect.top);
  } else { view.x -= event.deltaX; view.y -= event.deltaY; applyView(); }
}, { passive: false });
$('viewport').onpointerdown = event => {
  if (event.button !== 0 || event.target.closest('button')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
  $('viewport').setPointerCapture(event.pointerId); $('viewport').classList.add('dragging');
};
$('viewport').onpointermove = event => {
  if (!drag || drag.id !== event.pointerId) return;
  view.x = drag.startX + event.clientX - drag.x; view.y = drag.startY + event.clientY - drag.y; applyView();
};
function endDrag() { drag = null; $('viewport').classList.remove('dragging'); }
$('viewport').onpointerup = endDrag; $('viewport').onpointercancel = endDrag;
$('viewport').onkeydown = event => {
  if (event.target !== $('viewport')) return;
  if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
  if (['+', '='].includes(event.key)) zoom(1.2);
  if (event.key === '-') zoom(1 / 1.2);
  if (event.key === '0') fit(); if (event.key === 'Home') locate();
  if (event.key.startsWith('Arrow')) {
    view.x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
    view.y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0; applyView();
  }
};
bridge.on('ui/notifications/host-context-changed', context => {
  theme(context);
  applyLocale(context);
  const cosmetic = ['theme', 'styles', 'locale', 'timeZone', 'containerDimensions', 'displayMode', 'safeAreaInsets'];
  if (Object.keys(context || {}).length && Object.keys(context).every(key => cosmetic.includes(key))) return;
  selectedThreadId = undefined; load({ context: true });
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden && inView) load({ refresh: true, background: true });
});
window.addEventListener('focus', () => { if (!document.hidden && inView && !loading) load({ background: true }); });
const visibility = new IntersectionObserver(entries => {
  const previous = inView;
  inView = entries.some(entry => entry.isIntersecting);
  if (!inView) clearTimeout(timer);
  else if (!previous && !document.hidden) load({ refresh: true, background: true });
});
visibility.observe(document.documentElement);
let viewportSize;
const observer = new ResizeObserver(() => {
  const size = { width: $('viewport').clientWidth, height: $('viewport').clientHeight };
  if (!size.width || !size.height) return;
  if (needsCenter && geometry?.nodes.length) { needsCenter = false; locate(); }
  else if (viewportSize) { view.x += (size.width - viewportSize.width) / 2; view.y += (size.height - viewportSize.height) / 2; applyView(); }
  viewportSize = size;
});
observer.observe($('viewport'));
window.addEventListener('pagehide', () => {
  stopped = true; epoch++; clearTimeout(timer); clearTimeout(searchTimer); observer.disconnect(); visibility.disconnect(); bridge.close();
}, { once: true });
window.addEventListener('openai:set_globals', event => {
  if (event.detail?.globals?.locale) applyLocale({ locale: event.detail.globals.locale });
});
applyLocale({}, false);
bridge.initialize().then(context => { theme(context.hostContext); applyLocale(context.hostContext, false); load(); })
  .catch(error => status('error', true, error.message));
