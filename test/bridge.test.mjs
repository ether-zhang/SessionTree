import test from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge, dataLoadError } from '../plugins/session-tree/src/ui/codex/transport.mjs';

function host(handler) {
  const listeners = new Set(), sent = [];
  const window = {
    addEventListener(name, callback) { if (name === 'message') listeners.add(callback); },
    removeEventListener(name, callback) { listeners.delete(callback); },
    parent: { postMessage(message) { sent.push(message); queueMicrotask(() => handler(message, emit, window)); } },
  };
  function emit(data, source = window.parent) { for (const listener of listeners) listener({ source, data }); }
  return { window, sent, emit, listeners };
}

test('embedded app handshakes before requesting UI-only data, without HTTP', async () => {
  const panel = { version: 1, mode: 'choose', nativeId: null, index: { version: 1, nodes: [{ id: 'test' }] } };
  const fixture = host((message, emit) => {
    if (message.method === 'ui/initialize') emit({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostCapabilities: {} } });
    if (message.method === 'tools/call') emit({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { sessions: 1 }, _meta: { sessionTreePanel: panel } } });
  });
  const bridge = new AppBridge(fixture.window);
  assert.deepEqual(await bridge.loadPanel(), panel);
  assert.deepEqual(await bridge.loadPanel({ refresh: true }), panel);
  assert.deepEqual(fixture.sent.map(message => message.method), ['ui/initialize', 'ui/notifications/initialized', 'tools/call', 'tools/call']);
  assert.deepEqual(fixture.sent.at(-1).params, { name: 'session_tree_panel_data', arguments: { refresh: true } });
  bridge.close();
  assert.equal(fixture.listeners.size, 0);
});

test('messages from other frames cannot resolve a pending request', async () => {
  const fixture = host((message, emit) => {
    emit({ jsonrpc: '2.0', id: message.id, result: 'forged' }, {});
    emit({ jsonrpc: '2.0', id: message.id, result: 'trusted' });
  });
  const bridge = new AppBridge(fixture.window);
  assert.equal(await bridge.request('ping', {}), 'trusted');
  bridge.close();
});

test('a failed host call or timeout reports a usable error', async () => {
  const fixture = host((message, emit) => { emit({ jsonrpc: '2.0', id: message.id, error: { message: 'plugin disabled' } }); });
  const bridge = new AppBridge(fixture.window);
  await assert.rejects(bridge.request('tools/call', {}), /plugin disabled/);
  bridge.close();
  const silent = new AppBridge(host(() => {}).window, { timeoutMs: 10 });
  await assert.rejects(silent.request('ping', {}), /客户端请求超时/);
  assert.equal(silent.pending.size, 0);
  silent.close();
});

test('conversation panel uses app-only tools and native deep links without sending a model message', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const panel = { version: 1, mode: 'current', nativeId: id, index: { version: 1, nodes: [] } };
  const fixture = host((message, emit) => {
    const result = message.method === 'tools/call' ? { _meta: { sessionTreePanel: panel } } : {};
    if (message.id) emit({ jsonrpc: '2.0', id: message.id, result });
  });
  const bridge = new AppBridge(fixture.window);
  assert.deepEqual(await bridge.loadPanel({ refresh: true }), panel);
  assert.deepEqual(fixture.sent.at(-1).params, { name: 'session_tree_panel_data', arguments: { refresh: true } });
  await bridge.openThread(`codex://threads/${id}`);
  assert.deepEqual(fixture.sent.at(-1), { jsonrpc: '2.0', id: 'session-tree-3', method: 'ui/open-link', params: { url: `codex://threads/${id}` } });
  const sent = fixture.sent.length;
  await assert.rejects(bridge.openThread('javascript:alert(1)'), /无效/);
  assert.equal(fixture.sent.length, sent);
  bridge.close();
});

test('panel context notifications reject other frames and can be unsubscribed', () => {
  const fixture = host(() => {}), bridge = new AppBridge(fixture.window), received = [];
  const off = bridge.on('ui/notifications/host-context-changed', context => received.push(context));
  const change = { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } };
  fixture.emit(change, {});
  fixture.emit(change);
  off();
  fixture.emit(change);
  assert.deepEqual(received, [{ theme: 'dark' }]);
  bridge.close();
});

test('native opening results render without a redundant tool call, including delayed delivery', async () => {
  const panel = { version: 1, mode: 'choose', nativeId: null, index: { version: 1, nodes: [] } };
  for (const delayed of [false, true]) {
    const fixture = host((message, emit) => {
      if (message.method === 'ui/initialize') {
        emit({ jsonrpc: '2.0', id: message.id, result: {} });
        if (!delayed) emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { sessionTreePanel: panel } } });
      }
      if (delayed && message.method === 'ui/notifications/initialized') {
        setTimeout(() => emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { sessionTreePanel: panel } } }), 10);
      }
      if (message.method === 'tools/call') emit({ jsonrpc: '2.0', id: message.id, error: { message: 'Transport closed' } });
    });
    const bridge = new AppBridge(fixture.window);
    assert.deepEqual(await bridge.loadPanel(), panel);
    assert.equal(fixture.sent.filter(message => message.method === 'tools/call').length, 0);
    // A refresh must contact the host rather than silently reuse opening data.
    await assert.rejects(bridge.loadPanel({ refresh: true }), /Transport closed/);
    bridge.close();
  }
});

test('panel consumes opening metadata once, then requests fresh data', async () => {
  const initial = { version: 1, mode: 'choose', index: { version: 1, nodes: [{ id: 'initial' }] } };
  const latest = { version: 1, mode: 'choose', index: { version: 1, nodes: [{ id: 'fresh' }] } };
  const fixture = host((message, emit) => {
    if (message.method === 'ui/initialize') {
      emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { sessionTreePanel: initial } } });
      emit({ jsonrpc: '2.0', id: message.id, result: {} });
    }
    if (message.method === 'tools/call') emit({ jsonrpc: '2.0', id: message.id, result: { _meta: { sessionTreePanel: latest } } });
  });
  const bridge = new AppBridge(fixture.window);
  assert.deepEqual(await bridge.loadPanel(), initial);
  assert.deepEqual(await bridge.loadPanel(), latest);
  assert.equal(fixture.sent.filter(message => message.method === 'tools/call').length, 1);
  bridge.close();
});

test('context changes and manual selection cannot reuse the previous opening snapshot', async () => {
  const stale = { version: 1, mode: 'current', nativeId: 'old', index: { version: 1, nodes: [] } };
  const fresh = { version: 1, mode: 'choose', nativeId: null, index: { version: 1, nodes: [] } };
  for (const selected of [undefined, '00000000-0000-4000-8000-000000000001']) {
    const fixture = host((message, emit) => {
      if (message.method === 'ui/initialize') {
        emit({ jsonrpc: '2.0', id: message.id, result: {} });
        emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { sessionTreePanel: stale } } });
        if (!selected) emit({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: {} });
      }
      if (message.method === 'tools/call') emit({ jsonrpc: '2.0', id: message.id, result: { _meta: { sessionTreePanel: fresh } } });
    });
    const bridge = new AppBridge(fixture.window);
    assert.deepEqual(await bridge.loadPanel({ currentThreadId: selected }), fresh);
    assert.equal(fixture.sent.filter(message => message.method === 'tools/call').length, 1);
    bridge.close();
  }
});

test('failed opening results remain errors and closing cancels initial delivery waits', async () => {
  const fixture = host((message, emit) => {
    if (message.method === 'ui/initialize') {
      emit({ jsonrpc: '2.0', id: message.id, result: {} });
      emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { isError: true, content: [{ type: 'text', text: 'Transport closed' }] } });
    }
  });
  const bridge = new AppBridge(fixture.window);
  await assert.rejects(bridge.loadPanel(), /Transport closed/);
  bridge.close();
  const waiting = new AppBridge(host(() => {}).window);
  const first = waiting.takeOpeningResult();
  waiting.close();
  assert.equal(await first, undefined);
  await assert.rejects(waiting.request('tools/call', {}), /界面已关闭/);
  assert.match(dataLoadError(new Error('tool call: Transport closed')), /完全退出 Codex/);
  assert.equal(dataLoadError(new Error('other error')), 'other error');
});

test('unchanged revisions reuse the same panel and cannot hide a different host conversation', async () => {
  const panel = { version: 1, revision: 'known', nativeId: 'thread-a', mode: 'current', index: { version: 1, nodes: [] } };
  let mismatch = false, calls = 0;
  const fixture = host((message, emit) => {
    let result = {};
    if (message.method === 'tools/call') {
      result = calls++ === 0 ? { _meta: { sessionTreePanel: panel } } :
        { _meta: { sessionTreeUnchanged: { revision: 'known', nativeId: mismatch ? 'thread-b' : 'thread-a', mode: 'current' } } };
    }
    if (message.id) emit({ jsonrpc: '2.0', id: message.id, result });
  });
  const bridge = new AppBridge(fixture.window, { initialResultTimeoutMs: 0 });
  const first = await bridge.loadPanel();
  assert.equal(await bridge.loadPanel(), first);
  assert.equal(fixture.sent.at(-1).params.arguments.since_revision, 'known');
  mismatch = true;
  await assert.rejects(bridge.loadPanel(), /对话已经变化/);
  bridge.close();
});

