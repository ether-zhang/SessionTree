import { useCallback, useEffect, useRef, useState } from 'react';
import { AppBridge, dataLoadError } from '../../plugins/session-tree/src/ui/codex/transport.mjs';
import { canonicalUiLocale } from '../../plugins/session-tree/src/ui/codex/i18n.mjs';
import { panelNodeUrl } from '../../plugins/session-tree/src/ui/codex/panel-model.mjs';
import type { Bridge, HostContext, LoadOptions, Panel, SessionNode } from './types';

interface Controller {
  load(options?: LoadOptions): Promise<void>;
  select(id?: string): void;
  open(node: SessionNode): Promise<void>;
}

export function useSessionTree() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(true);
  const [familyEpoch, setFamilyEpoch] = useState(0);
  const [locale, setLocale] = useState(() => canonicalUiLocale(window.openai?.locale || navigator.language) || 'en');
  const [theme, setTheme] = useState<string>();
  const [status, setStatus] = useState({ key: 'loading', error: false, detail: '' });
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    const bridge = new AppBridge(window, { displayModes: ['fullscreen'] }) as unknown as Bridge;
    let lastPanel: Panel | null = null, selected: string | undefined, clientLocale: string | undefined;
    let epoch = 0, stopped = false, busy = false, navigating = false, inView = true, delay = 12000;
    let timer: number | undefined;

    function applyContext(context: HostContext = {}) {
      if (context.theme === 'light' || context.theme === 'dark') setTheme(context.theme);
      clientLocale = canonicalUiLocale(context.locale) || clientLocale;
      setLocale(canonicalUiLocale(clientLocale || window.openai?.locale || bridge.locale || navigator.language) || 'en');
    }
    function schedule() {
      window.clearTimeout(timer);
      if (!stopped && !bridge.closed && !document.hidden && inView) {
        timer = window.setTimeout(() => void load({ background: true }), delay);
      }
    }
    async function load({ refresh = false, background = false, context = false }: LoadOptions = {}) {
      if (stopped || bridge.closed || (busy && background)) return;
      window.clearTimeout(timer);
      const ticket = ++epoch, previous = lastPanel;
      busy = true; setLoading(true);
      if (context || !previous) { setTransitioning(true); setStatus({ key: 'loading', error: false, detail: '' }); }
      else if (!background) setStatus({ key: 'loading', error: false, detail: '' });
      try {
        const next = await bridge.loadPanel({ refresh, currentThreadId: selected, check: context });
        if (stopped || ticket !== epoch) return;
        applyContext();
        if (previous?.nativeId !== next.nativeId || previous?.index.rootId !== next.index.rootId) setFamilyEpoch(value => value + 1);
        lastPanel = next; setPanel(next); setTransitioning(false);
        setStatus({ key: '', error: false, detail: '' });
        delay = next === previous ? Math.min(30000, delay * 1.5) : 12000;
      } catch (error) {
        if (!stopped && ticket === epoch) {
          setStatus({ key: 'error', error: true, detail: dataLoadError(error as Error) });
          delay = Math.min(60000, delay * 2);
        }
      } finally {
        if (!stopped && ticket === epoch) { busy = false; setLoading(false); schedule(); }
      }
    }
    controller.current = {
      load,
      select(id) { selected = id; void load({ context: true }); },
      async open(node) {
        const url = panelNodeUrl(node);
        if (!url || stopped || navigating) return;
        navigating = true; const ticket = epoch;
        setStatus({ key: 'loading', error: false, detail: '' });
        try { await bridge.openThread(url); if (!stopped && ticket === epoch) setStatus({ key: '', error: false, detail: '' }); }
        catch (error) { if (!stopped && ticket === epoch) setStatus({ key: 'error', error: true, detail: (error as Error).message }); }
        finally { navigating = false; }
      },
    };
    const offContext = bridge.on('ui/notifications/host-context-changed', context => {
      applyContext(context);
      const cosmetic = ['theme', 'styles', 'locale', 'timeZone', 'containerDimensions', 'displayMode', 'safeAreaInsets'];
      if (Object.keys(context || {}).length && Object.keys(context).every(key => cosmetic.includes(key))) return;
      selected = undefined; void load({ context: true });
    });
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden && inView) void load({ refresh: true, background: true });
    };
    const onFocus = () => { if (!document.hidden && inView && !busy) void load({ background: true }); };
    const onGlobals = (event: Event) => {
      const next = (event as CustomEvent<{ globals?: { locale?: string } }>).detail?.globals?.locale;
      if (next) applyContext({ locale: next });
    };
    const visibility = new IntersectionObserver(entries => {
      const previous = inView;
      inView = entries.some(entry => entry.isIntersecting);
      if (!inView) window.clearTimeout(timer);
      else if (!previous && !document.hidden) void load({ refresh: true, background: true });
    });
    visibility.observe(document.documentElement);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('openai:set_globals', onGlobals);
    const stop = () => {
      stopped = true; epoch++; window.clearTimeout(timer);
      visibility.disconnect(); offContext(); bridge.close(); controller.current = null;
    };
    window.addEventListener('pagehide', stop, { once: true });
    void bridge.initialize().then(context => {
      if (!stopped) { applyContext(context.hostContext); void load(); }
    }).catch(error => { if (!stopped) setStatus({ key: 'error', error: true, detail: error.message }); });
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('openai:set_globals', onGlobals);
      window.removeEventListener('pagehide', stop);
    };
  }, []);

  return {
    panel, loading, transitioning, familyEpoch, locale, theme, status,
    refresh: useCallback(() => void controller.current?.load({ refresh: true }), []),
    select: useCallback((id?: string) => controller.current?.select(id), []),
    open: useCallback((node: SessionNode) => void controller.current?.open(node), []),
  };
}
