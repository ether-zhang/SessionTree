import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const records = [
  ['root', null, '总体方案'], ['ui', 'root', '界面设计'], ['canvas', 'ui', 'Explorer 画布与会话分叉导航'],
  ['render', 'canvas', '绘图优化'], ['storage', 'root', '数据适配'], ['index', 'storage', '增量索引'],
  ['old', 'storage', '旧版原型', true], ['release', 'root', '发布准备'],
];
const snapshot = { type: 'snapshot', selectedId: 'canvas', locale: 'zh-CN', agentLabel: 'Codex',
  nodes: records.map(([id, parentId, title, archived], index) => ({ id, parentId, title, archived: Boolean(archived),
    nativeId: id, agent: 'fixture', workspace: '/example/project', createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z` })),
  labels: { title: '会话分叉图，可拖动平移、滚轮缩放。', listTitle: '会话列表', zoomIn: '放大', zoomOut: '缩小', fit: '适应整棵树',
    locate: '定位选定会话', selected: '选定', archived: '已归档', missing: '来源会话不可用', origin: '来源', updated: '最近活动',
    firstReply: '首条 Codex 回复', user: '用户', emptyUser: '暂无可读的用户消息。', loadingReply: '正在读取首条回复…', emptyReply: '暂无可读的助手回复。',
    limitedReply: '首条回复超出预览读取范围。', unavailableReply: '首条回复暂不可读。' } };
const replies = Object.fromEntries(records.map(([id]) => [id, '已改成从左向右的紧凑树图，悬停显示两行摘要。']));
const mock = `const sample=${JSON.stringify(snapshot)},replies=${JSON.stringify(replies)};
const list={...sample,selectedId:null,nodes:[...sample.nodes].reverse().concat(Array.from({length:80},(_,i)=>({id:'example-'+i,nativeId:'example-'+i,title:'示例会话 '+(i+1),agent:'fixture',workspace:'/example/project'})))};
let saved,reads=0,current=new URLSearchParams(location.search).has('tree')?sample:list;
const send=()=>{window.postMessage(current,'*');document.getElementById('preview-back').hidden=!current.selectedId};
window.acquireVsCodeApi=()=>({getState:()=>saved,setState:value=>{saved=value},postMessage:message=>{
if(message.type==='ready')setTimeout(send,0);
if(message.type==='openTree'){const node=list.nodes.find(node=>node.id===message.nodeId&&!node.archived);if(node){current={...sample,selectedId:node.id,nodes:sample.nodes.some(item=>item.id===node.id)?sample.nodes:[node]};send()}}
if(message.type==='preview'){document.getElementById('preview-reads').textContent=String(++reads);setTimeout(()=>window.postMessage({type:'firstReply',treeId:message.treeId,nodeId:message.nodeId,requestId:message.requestId,preview:{status:'available',user:'节点从左向右排列，预览简洁一点。',text:replies[message.nodeId]||'这是一条虚构会话的首条回复。'}},'*'),40)}
if(message.type==='openConversation')document.getElementById('preview-opened').textContent=message.nodeId;
}});
document.getElementById('preview-back').addEventListener('click',()=>{current=list;send()});`;
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self';">
<link rel="stylesheet" href="/graph.css"><link rel="stylesheet" href="/fixture.css"></head><body>
<div id="root"></div><output id="preview-reads" aria-label="Mock preview reads">0</output><output id="preview-opened" aria-label="Mock navigation target">none</output><button id="preview-back" hidden>返回会话列表（模拟宿主）</button><script src="/mock-host.js"></script><script type="module" src="/graph.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); }
    else if (pathname === '/mock-host.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(mock); }
    else if (pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css; charset=utf-8'); response.end('#root{width:min(360px,100vw);height:min(420px,100vh);border:1px solid #41434e}#preview-reads{position:absolute;left:380px;top:12px;color:#999}#preview-opened{position:absolute;left:380px;top:80px;color:#999}#preview-back{position:absolute;left:380px;top:44px}'); }
    else if (pathname === '/graph.js' || pathname === '/graph.css') {
      response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      response.end(await readFile(join(root, 'extensions/vscode/media', pathname.slice(1))));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(500); response.end('Preview failed'); }
});
server.listen(0, '127.0.0.1', () => console.log('Synthetic graph preview: http://127.0.0.1:' + server.address().port + '/  (q to stop)'));
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { if (data.trim() === 'q') server.close(() => process.exit(0)); });
