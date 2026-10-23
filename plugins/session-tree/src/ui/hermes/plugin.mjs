import { createElement, useEffect, useLayoutEffect, useRef } from 'react';
import { host, Button, PANES_AREA, TITLEBAR_AREAS, useI18n, useValue } from '@hermes/plugin-sdk';
import { HermesTreeHost } from './host.mjs';
import { createHermesSdkSource } from '../../adapters/hermes-sdk.mjs';
import { mountTreePanel } from '../shared/panel.mjs';

// The builder replaces these with the same shared renderer used by Codex.
const PANEL_MARKUP = '__SESSION_TREE_PANEL_MARKUP__';
const PLUGIN_ICON = '__SESSION_TREE_PLUGIN_ICON__';
const PANE_ID = 'session-tree:tree';

export default {
  id: 'session-tree',
  name: 'SessionTree',
  description: 'A persistent, zoomable map of the focused Hermes conversation and its branches.',
  defaultEnabled: false,
  register(ctx) {
    let paneRegistered = false;
    let locale = 'en';
    const appearance = () => ({
      locale, theme: getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light',
    });
    const treeHost = new HermesTreeHost({
      ...createHermesSdkSource(host), readAppearance: appearance,
    });
    ctx.onDispose(() => treeHost.close());
    ctx.onDispose(host.state.focusedStoredSessionId.listen(() => treeHost.contextChanged()));
    ctx.onDispose(host.state.focusedSessionOwner.listen(() => treeHost.contextChanged()));
    ctx.onEvent('sessions.changed', () => treeHost.invalidate());
    ctx.onEvent('message.end', () => treeHost.invalidate());

    function SessionTreePane() {
      const { locale: currentLocale } = useI18n();
      locale = currentLocale;
      const container = useRef(null);
      const visible = useValue(host.paneVisibility(PANE_ID));
      useLayoutEffect(() => {
        const root = container.current.shadowRoot || container.current.attachShadow({ mode: 'open' });
        root.innerHTML = PANEL_MARKUP;
        const controller = mountTreePanel(window, treeHost, { root, assistantLabel: 'Hermes' });
        return () => controller.destroy();
      }, []);
      useEffect(() => { treeHost.appearanceChanged(); }, [currentLocale]);
      useEffect(() => { treeHost.emit('visibilitychange', visible); }, [visible]);
      useEffect(() => {
        const observer = new MutationObserver(() => treeHost.appearanceChanged());
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        return () => observer.disconnect();
      }, []);
      return createElement('div', {
        ref: container, role: 'region', 'aria-label': 'SessionTree',
        style: { width: '100%', height: '100%', minHeight: 280, display: 'block' },
      });
    }

    function openTree() {
      if (!paneRegistered) {
        ctx.register({
          id: 'tree', area: PANES_AREA, title: 'SessionTree',
          data: { placement: 'right', width: '480px', minWidth: '300px', lifecycleKeepAlive: true,
            dock: { pane: 'workspace', pos: 'right' } },
          render: () => createElement(SessionTreePane),
        });
        paneRegistered = true;
      }
      host.undismissPane(PANE_ID);
      host.revealPane(PANE_ID);
    }
    ctx.register({
      id: 'open', area: TITLEBAR_AREAS.left, order: 150,
      render: () => createElement(Button, {
        'aria-label': 'SessionTree', title: 'SessionTree', size: 'icon', variant: 'ghost', onClick: openTree,
      }, createElement('img', { src: PLUGIN_ICON, alt: '', style: { width: 20, height: 20 } })),
    });
  },
};
