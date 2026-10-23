import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TREE_ICON } from '../plugins/session-tree/src/ui/shared/resource.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist', 'session-tree-hermes');
const base = new URL('../plugins/session-tree/src/', import.meta.url);
const files = ['core/tree.mjs', 'core/layout.mjs', 'adapters/hermes.mjs', 'adapters/hermes-sdk.mjs', 'ui/shared/i18n.mjs',
  'ui/shared/conversation-view.mjs', 'ui/shared/panel-model.mjs', 'ui/shared/panel.mjs', 'ui/hermes/host.mjs'];
const chunks = await Promise.all(files.map(path => readFile(new URL(path, base), 'utf8')));
const html = await readFile(new URL('ui/shared/panel.html', base), 'utf8');
const css = (await readFile(new URL('ui/shared/panel.css', base), 'utf8'))
  .replace(/:root(:not\([^)]+\)|\[[^\]]+\])?/g, (_, selector) => selector ? ':host(' + selector + ')' : ':host')
  .replaceAll('html,body', ':host,.panel-body').replace(/(^|\n)body\s*\{/g, '$1.panel-body {');
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace('<!-- session-tree-icon -->', () => TREE_ICON);
const markup = '<style>' + css + '</style><section class="panel-body">' + body + '</section>';
const template = await readFile(new URL('ui/hermes/plugin.mjs', base), 'utf8');
const plugin = template
  .replaceAll("'__SESSION_TREE_PANEL_MARKUP__'", () => JSON.stringify(markup))
  .replaceAll("'__SESSION_TREE_PLUGIN_ICON__'", () =>
    JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(TREE_ICON).toString('base64')))
  .replace(/^import .+from '\..+;\r?$/gm, '');
const shared = chunks.map(code => code.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '')).join('\n');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'plugin.js'), shared + '\n' + plugin);
await writeFile(join(output, 'README.md'), await readFile(new URL('../docs/HERMES.md', import.meta.url), 'utf8'));
console.log(JSON.stringify({ output, entrypoint: join(output, 'plugin.js'), externalImports: ['react', '@hermes/plugin-sdk'] }));
