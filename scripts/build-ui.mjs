import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.session-tree/ui-build');
await build({ configFile: join(root, 'vite.config.ts') });
let html = await readFile(join(output, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
async function asset(url) {
  const path = resolve(output, url);
  const child = relative(output, path);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'UI asset escaped build directory');
  return readFile(path, 'utf8');
}
for (const match of styles) {
  const css = await asset(match[1]);
  html = html.replace(match[0], () => '<style>' + css + '</style>');
}
for (const match of scripts) {
  const code = (await asset(match[1])).replace(/<\/script/gi, '<\\/script');
  html = html.replace(match[0], () => '<script type="module">' + code + '</script>');
}
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
assert.ok(!/<script\b[^>]*\bsrc=|<link\b[^>]*href=/.test(markup), 'UI still requests external build assets');
await writeFile(join(root, 'plugins/session-tree/assets/panel.html'), html);
const notices = [];
for (const name of ['react', 'react-dom', 'scheduler']) {
  const packageRoot = join(root, 'node_modules', name);
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  notices.push(name + ' ' + manifest.version + '\n\n' + await readFile(join(packageRoot, 'LICENSE'), 'utf8'));
}
await writeFile(join(root, 'plugins/session-tree/assets/frontend-licenses.txt'), notices.join('\n\n---\n\n'));
console.log('Self-contained React panel: ' + Buffer.byteLength(html) + ' bytes; no runtime npm dependencies or external UI requests.');
await import('./sync-native-assets.mjs');
