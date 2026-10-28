const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('Codex navigation dispatches the exact local thread URI and rejects unsafe or inactive records', async t => {
  let installed = true, accepted = true;
  const opened = [];
  const vscode = {
    extensions: { getExtension: id => id === 'openai.chatgpt' && installed ? {} : undefined },
    Uri: { from: components => components },
    env: { uriScheme: 'vscode-insiders', openExternal: async uri => { opened.push(uri); return accepted; } },
  };
  const original = Module._load;
  t.mock.method(Module, '_load', function (name, ...args) {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  });
  const { openCodexConversation } = require('../out/agents/codex-navigation');
  const node = { id:'codex:fixture', nativeId:'00000000-0000-4000-8000-000000000001', agent:'codex', title:'fixture', workspace:'/example' };
  assert.equal(await openCodexConversation(node), true);
  assert.deepEqual(opened, [{ scheme:'vscode-insiders', authority:'openai.chatgpt', path:'/local/' + node.nativeId }]);
  for (const extra of [{archived:true}, {missing:true}, {subagent:true}, {agent:'other'}, {nativeId:'../../command?run=anything'}, {nativeId:null}]) {
    assert.equal(await openCodexConversation({...node,...extra}), false);
  }
  installed = false;
  assert.equal(await openCodexConversation(node), false);
  assert.equal(opened.length, 1);
  installed = true; accepted = false;
  assert.equal(await openCodexConversation(node), false);
});
