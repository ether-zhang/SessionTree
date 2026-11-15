const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('foreground changes reach an unchanged webview and the latest state is restored after hiding', t => {
  const disposable = { dispose() {} };
  const vscode = {
    EventEmitter: class { event() { return disposable; } fire() {} dispose() {} },
    Uri: { joinPath: (root, ...parts) => root + '/' + parts.join('/') },
    l10n: { t: text => text },
  };
  const original = Module._load;
  t.mock.method(Module, '_load', function (name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); });
  const { GraphView } = require('../out/graph-view');
  const messages = [];
  let receive, visibility;
  const view = {
    visible: true,
    webview: {
      cspSource: 'vscode-webview:', asWebviewUri: uri => uri,
      onDidReceiveMessage: listener => { receive = listener; return disposable; },
      postMessage: async message => { messages.push(message); return true; },
    },
    onDidChangeVisibility: listener => { visibility = listener; return disposable; },
    onDidDispose: () => disposable,
  };
  const graph = new GraphView('/extension', async () => ({status:'unavailable'}), {openTree() {}, openConversation() {}});
  t.after(() => graph.dispose());
  const snapshot = {type:'snapshot', selectedId:'root', nodes:[], locale:'en', agentLabel:'Codex', labels:{}};
  graph.update(snapshot); graph.setActive(true); graph.resolveWebviewView(view);
  assert.equal(messages.length, 0);
  receive({type:'ready'});
  assert.deepEqual(messages, [{type:'activity', active:true}, snapshot]);
  messages.length = 0;
  graph.setActive(false); graph.setActive(false);
  assert.deepEqual(messages, [{type:'activity', active:false}]);
  messages.length = 0;
  view.visible = false; visibility(); graph.setActive(true);
  assert.equal(messages.length, 0);
  view.visible = true; visibility(); receive({type:'ready'});
  assert.deepEqual(messages, [{type:'activity', active:true}, snapshot]);
});
