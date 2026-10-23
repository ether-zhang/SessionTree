import { readFile } from 'node:fs/promises';

export const TREE_ICON = await readFile(new URL('../../../assets/session-tree.svg', import.meta.url), 'utf8');

/** Bundle the shared renderer with a host's small bootstrap; no server or SDK in the renderer. */
export async function createPanelHtml(hostModules) {
  const common = ['../../core/tree.mjs', '../../core/layout.mjs', './i18n.mjs',
    './conversation-view.mjs', './panel-model.mjs', './panel.mjs'];
  const [html, css, ...modules] = await Promise.all([
    readFile(new URL('./panel.html', import.meta.url), 'utf8'),
    readFile(new URL('./panel.css', import.meta.url), 'utf8'),
    ...common.map(path => readFile(new URL(path, import.meta.url), 'utf8')),
    ...hostModules.map(url => readFile(url, 'utf8')),
  ]);
  const script = modules.map(code => code.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '')).join('\n');
  return html.replace('<!-- session-tree-icon -->', () => TREE_ICON)
    .replace('<link rel="stylesheet" href="panel.css">', () => '<style>' + css + '</style>')
    .replace('<script type="module" src="panel.mjs"></script>', () =>
      '<script type="module">' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
}
