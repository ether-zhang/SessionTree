import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = join(root, 'extensions/vscode/media');
await build({ configFile: false, root, base: './', logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' },
  build: { outDir: output, emptyOutDir: true, cssCodeSplit: false, modulePreload: false,
    lib: { entry: join(root, 'frontend/vscode/graph.tsx'), formats: ['es'], fileName: () => 'graph.js', cssFileName: 'graph' },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
const notices = [];
for (const name of ['react', 'react-dom', 'scheduler']) {
  const directory = join(root, 'node_modules', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices.push(name + ' ' + manifest.version + '\n\n' + await readFile(join(directory, 'LICENSE'), 'utf8'));
}
await mkdir(output, { recursive: true });
await writeFile(join(output, 'frontend-licenses.txt'), notices.join('\n\n---\n\n') + '\n');
