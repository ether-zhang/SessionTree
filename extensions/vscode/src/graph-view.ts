import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { FirstReply, GraphSnapshot } from './types';

/** Both navigation levels share one Explorer view, including its native size and position. */
export class GraphView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private snapshot?: GraphSnapshot;
  private signature = '';
  private listeners: vscode.Disposable[] = [];
  private previews = new Map<string, Promise<FirstReply>>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeVisibility = this.changed.event;
  get visible(): boolean { return Boolean(this.view?.visible); }

  constructor(private readonly extensionUri: vscode.Uri, private readonly readPreview: (nodeId: string) => Promise<FirstReply>,
    private readonly actions: { openTree(nodeId: string): void; openConversation(nodeId: string): void }) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    for (const listener of this.listeners) listener.dispose();
    this.view = view; this.ready = false;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'graph.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'graph.css'));
    const nonce = randomBytes(18).toString('base64');
    view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${view.webview.cspSource};">
      <link rel="stylesheet" href="${style}"></head><body><div id="root"></div>
      <script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
    this.listeners = [view.webview.onDidReceiveMessage(message => {
      if (message && typeof message === 'object' && message.type === 'ready') { this.ready = true; this.send(); }
      else if (message && typeof message === 'object' && message.type === 'preview') void this.preview(message);
      else if (message?.type === 'openTree' && !this.snapshot?.selectedId && typeof message.nodeId === 'string'
        && this.snapshot?.nodes.some(node => node.id === message.nodeId && !node.archived && !node.missing)) this.actions.openTree(message.nodeId);
      else if (view.visible && message?.type === 'openConversation' && this.snapshot?.selectedId && message.treeId === this.snapshot.selectedId
        && typeof message.nodeId === 'string' && this.snapshot.nodes.some(node => node.id === message.nodeId && !node.archived && !node.missing)) {
        this.actions.openConversation(message.nodeId);
      }
    }), view.onDidChangeVisibility(() => { if (!view.visible) this.ready = false; this.send(); this.changed.fire(); }),
    view.onDidDispose(() => { this.view = undefined; this.ready = false; this.changed.fire(); })];
    this.send(); this.changed.fire();
  }

  update(snapshot: GraphSnapshot): void {
    const signature = JSON.stringify(snapshot);
    if (signature === this.signature) return;
    this.signature = signature; this.snapshot = snapshot; this.send();
  }

  private send(): void {
    if (!this.view || !this.snapshot) return;
    this.view.description = this.snapshot.selectedId ? vscode.l10n.t('Conversation tree') : this.snapshot.agentLabel;
    const count = this.snapshot.nodes.filter(node => !node.missing).length;
    this.view.badge = count ? { value: count, tooltip: vscode.l10n.t('{0} sessions', count) } : undefined;
    if (this.ready && this.view.visible) void this.view.webview.postMessage(this.snapshot);
  }

  private async preview(message: { nodeId?: unknown; treeId?: unknown; requestId?: unknown }): Promise<void> {
    const view = this.view, treeId = this.snapshot?.selectedId, nodeId = message.nodeId;
    if (!view?.visible || !treeId || message.treeId !== treeId || typeof nodeId !== 'string'
      || !Number.isSafeInteger(message.requestId) || !this.snapshot?.nodes.some(node => node.id === nodeId && !node.missing)) return;
    let pending = this.previews.get(nodeId);
    if (!pending) { pending = this.readPreview(nodeId); this.previews.set(nodeId, pending); }
    let preview: FirstReply;
    try { preview = await pending; } catch { preview = { status: 'unavailable' }; }
    if (this.previews.get(nodeId) === pending) this.previews.delete(nodeId);
    if (this.view === view && view.visible && this.snapshot?.selectedId === treeId) {
      void view.webview.postMessage({ type: 'firstReply', treeId, nodeId, requestId: message.requestId, preview });
    }
  }

  dispose(): void {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = []; this.view = undefined; this.changed.dispose();
  }
}
