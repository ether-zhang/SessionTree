import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { appResource, PANEL_URI } from '../plugins/session-tree/src/ui/codex/resource.mjs';

// Fixture-only host. It never reads or navigates real Codex conversations.
const assets = new Map([
  ['/', ['../test/fixtures/thread-panel-preview.html', 'text/html; charset=utf-8']],
  ['/tree.mjs', ['../plugins/session-tree/src/core/tree.mjs', 'text/javascript; charset=utf-8']],
  ['/core/tree.mjs', ['../plugins/session-tree/src/core/tree.mjs', 'text/javascript; charset=utf-8']],
  ['/panel-model.mjs', ['../plugins/session-tree/src/ui/codex/panel-model.mjs', 'text/javascript; charset=utf-8']],
  ['/conversation-view.mjs', ['../plugins/session-tree/src/ui/codex/conversation-view.mjs', 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  try {
    if (request.url === '/panel.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end((await appResource(PANEL_URI)).text);
      return;
    }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
    response.end(await readFile(new URL(asset[0], import.meta.url)));
  } catch { response.writeHead(500).end(); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, pid: process.pid, purpose: 'thread panel fixture preview' })));
process.stdin.on('data', data => { if (data.toString().trim() === 'q') server.close(() => process.exit(0)); });
process.on('SIGINT', () => server.close(() => process.exit(0)));
