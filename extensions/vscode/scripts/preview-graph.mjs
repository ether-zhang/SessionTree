import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const records = [
  ['root', null, '根节点标题测试'], ['ui', 'root', '界面设计'], ['canvas', 'ui', '会话树界面优化：节点长标题在前台持续滚动，预览标题保持单行，用户和 Codex 正文仅显示缩略信息'],
  ['render', 'canvas', '绘图优化：仅屏幕内的长标题持续滚动，后台停止动画'], ['storage', 'root', '数据适配'], ['index', 'storage', '增量索引'],
  ['old', 'storage', '旧版原型', true], ['release', 'root', '发布准备'],
];
const snapshot = { type: 'snapshot', selectedId: 'canvas', locale: 'zh-CN', agentLabel: 'Codex',
  nodes: records.map(([id, parentId, title, archived], index) => ({ id, parentId, title, archived: Boolean(archived),
    nativeId: id, agent: 'fixture', workspace: '/example/project', createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z` })),
  labels: { title: '会话分叉图，可拖动平移、滚轮缩放。', listTitle: '会话列表', zoomIn: '放大', zoomOut: '缩小', fit: '适应整棵树',
    locate: '定位选定会话', selected: '选定', archived: '已归档', missing: '来源会话不可用', origin: '来源', updated: '最近活动',
    firstReply: '首条 Codex 回复', user: '用户', emptyUser: '暂无可读的用户消息。', loadingReply: '正在读取首条回复…', emptyReply: '暂无可读的助手回复。',
    limitedReply: '首条回复超出预览读取范围。', unavailableReply: '首条回复暂不可读。' } };
const replies = Object.fromEntries(records.map(([id]) => [id, '可见节点中的长标题会自动滚动，预览标题保持单行，用户与 Codex 正文仍是静态缩略信息。']));
const mock = `const sample=${JSON.stringify(snapshot)},replies=${JSON.stringify(replies)};
const params=new URLSearchParams(location.search);
if(params.has('long-root'))sample.nodes.find(node=>node.id==='root').title='根节点自动滚动校验：较长标题在前台持续向前滚动，末尾直接跳回开头';
const list={...sample,selectedId:null,nodes:[...sample.nodes].reverse().concat(Array.from({length:80},(_,i)=>({id:'example-'+i,nativeId:'example-'+i,title:'示例会话 '+(i+1),agent:'fixture',workspace:'/example/project'})))};
const requested=params.get('tree');
let saved,reads=0,active=true,current=requested?{...sample,selectedId:sample.nodes.some(node=>node.id===requested)?requested:'canvas'}:list;
const send=()=>{window.postMessage({type:'activity',active},'*');window.postMessage(current,'*');document.getElementById('preview-back').hidden=!current.selectedId};
window.acquireVsCodeApi=()=>({getState:()=>saved,setState:value=>{saved=value},postMessage:message=>{
if(message.type==='ready')setTimeout(send,0);
if(message.type==='openTree'){const node=list.nodes.find(node=>node.id===message.nodeId&&!node.archived);if(node){current={...sample,selectedId:node.id,nodes:sample.nodes.some(item=>item.id===node.id)?sample.nodes:[node]};send()}}
if(message.type==='preview'){document.getElementById('preview-reads').textContent=String(++reads);setTimeout(()=>window.postMessage({type:'firstReply',treeId:message.treeId,nodeId:message.nodeId,requestId:message.requestId,preview:{status:'available',user:'让可见节点的长标题平时就滚动，切到后台时停止，正文保留缩略显示。',text:replies[message.nodeId]||'这是一条虚构会话的首条回复。'}},'*'),40)}
if(message.type==='openConversation')document.getElementById('preview-opened').textContent=message.nodeId;
}});
document.getElementById('preview-back').addEventListener('click',()=>{current=list;send()});
document.getElementById('preview-activity').addEventListener('click',event=>{active=!active;event.currentTarget.textContent=active?'模拟后台':'恢复前台';window.postMessage({type:'activity',active},'*')});
document.getElementById('preview-root-width').addEventListener('click',()=>document.body.classList.toggle('wide-root'));
document.getElementById('preview-root-check').addEventListener('click',()=>{const label=document.querySelector('[data-node-id="root"] .scroll-content'),animation=label?.getAnimations()[0];document.getElementById('preview-root-state').textContent=JSON.stringify({direction:animation?.effect?.getTiming().direction??null,iteration:animation?.effect?.getComputedTiming().currentIteration??null})});`;
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self';">
<link rel="stylesheet" href="/graph.css"><link rel="stylesheet" href="/fixture.css"></head><body>
<div id="root"></div><output id="preview-reads" aria-label="Mock preview reads">0</output><output id="preview-opened" aria-label="Mock navigation target">none</output><button id="preview-back" hidden>返回会话列表（模拟宿主）</button><button id="preview-activity">模拟后台</button><button id="preview-root-width">根标题变宽</button><button id="preview-root-check">检查根标题动画</button><output id="preview-root-state"></output><script src="/mock-host.js"></script><script type="module" src="/graph.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); }
    else if (pathname === '/mock-host.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(mock); }
    else if (pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css; charset=utf-8'); response.end('#root{width:min(360px,100vw);height:min(420px,100vh);border:1px solid #41434e}#preview-reads{position:absolute;left:380px;top:12px;color:#999}#preview-opened{position:absolute;left:380px;top:80px;color:#999}#preview-back{position:absolute;left:380px;top:44px}#preview-activity{position:absolute;left:380px;top:112px}#preview-root-width{position:absolute;left:380px;top:148px}#preview-root-check{position:absolute;left:380px;top:184px}#preview-root-state{position:absolute;left:380px;top:220px;color:#999}.wide-root [data-node-id="root"] .node-title{font-size:18px}'); }
    else if (pathname === '/graph.js' || pathname === '/graph.css') {
      response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      response.end(await readFile(join(root, 'extensions/vscode/media', pathname.slice(1))));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(500); response.end('Preview failed'); }
});
server.listen(0, '127.0.0.1', () => console.log('Synthetic graph preview: http://127.0.0.1:' + server.address().port + '/  (q to stop)'));
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { if (data.trim() === 'q') server.close(() => process.exit(0)); });
