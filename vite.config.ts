import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const project = process.cwd();
const fixtureAssets: Record<string, string> = {
  '/tree.mjs': 'plugins/session-tree/src/core/tree.mjs',
  '/core/tree.mjs': 'plugins/session-tree/src/core/tree.mjs',
  '/panel-model.mjs': 'plugins/session-tree/src/ui/codex/panel-model.mjs',
  '/conversation-view.mjs': 'plugins/session-tree/src/ui/codex/conversation-view.mjs',
};
export default defineConfig({
  root: resolve(project, 'frontend/codex'),
  base: './',
  plugins: [{
    name: 'session-tree-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/panel.html') { request.url = '/index.html'; next(); return; }
        const file = request.url === '/__preview' ? 'test/fixtures/thread-panel-preview.html' : fixtureAssets[request.url || ''];
        if (!file) { next(); return; }
        response.setHeader('Content-Type', request.url === '/__preview' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
        response.end(await readFile(resolve(project, file)));
      });
    },
  }],
  server: { host: '127.0.0.1', fs: { allow: [project] } },
  build: {
    outDir: resolve(project, '.session-tree/ui-build'),
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
