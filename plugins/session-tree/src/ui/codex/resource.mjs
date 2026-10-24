import { readFile } from 'node:fs/promises';

// Compatibility address only; there is no longer a separate full-index page.
export const APP_URI = 'ui://session-tree/app.html';
export const PANEL_URI = 'ui://session-tree/panel.html';
export const BUTTON_URI = 'ui://session-tree/conversation-button.html';
export const APP_MIME = 'text/html;profile=mcp-app';
export const ICON_SVG = await readFile(new URL('../../../assets/session-tree.svg', import.meta.url), 'utf8');
export const ICON_DATA_URI = 'data:image/svg+xml;base64,' + Buffer.from(ICON_SVG).toString('base64');

/** Saved viewer preferences can retain an address from an older package. */
export function canonicalResourceUri(uri) {
  if (uri === APP_URI || uri === PANEL_URI || uri === BUTTON_URI) return PANEL_URI;
  const legacy = typeof uri === 'string' && /^ui:\/\/session-tree\/v\d+\.\d+\.\d+\/(app|panel)\.html$/.exec(uri);
  return legacy ? PANEL_URI : null;
}

/** Vite produces one self-contained document; installed plugins need no build server. */
export async function appResource(uri = PANEL_URI) {
  const canonical = canonicalResourceUri(uri);
  if (!canonical) throw new Error('Unknown SessionTree resource.');
  return {
    uri, mimeType: APP_MIME,
    text: await readFile(new URL('../../../assets/panel.html', import.meta.url), 'utf8'),
    _meta: {
      ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' },
    },
  };
}
