import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from './agents/codex';
import { openCodexConversation } from './agents/codex-navigation';
import { SessionBrowser } from './tree';
import { VisibleReader } from './reader';
import { GraphView } from './graph-view';
import { Agent, FirstReply, SessionNode } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('SessionTree');
  const browser = new SessionBrowser();
  let reader: VisibleReader;
  const graph = new GraphView(context.extensionUri, async (nodeId): Promise<FirstReply> => {
    const node = browser.forest.nodes.get(nodeId);
    if (!vscode.window.state.focused || !browser.inTree || !node?.nativeId || node.missing || node.subagent) return { status: 'unavailable' };
    return reader.firstReply(node.nativeId);
  }, {
    openTree: nodeId => { void vscode.commands.executeCommand('sessionTree.openTree', nodeId); },
    openConversation: nodeId => { void vscode.commands.executeCommand('sessionTree.openConversation', nodeId); },
  });
  let disposed = false;
  let loaded = false;
  let readError: string | undefined;
  let openingConversation = false;
  const config = () => vscode.workspace.getConfiguration('sessionTree');
  const agents = new Map<string, Agent>([['codex', { id: 'codex', label: 'Codex', open: openCodexConversation, create: () => new CodexProvider({
    binary: join(context.extensionPath, 'bin', 'session-tree' + (process.platform === 'win32' ? '.exe' : '')),
    home: config().get<string>('codexHome')?.trim() || process.env.CODEX_HOME || join(homedir(), '.codex'),
    data: join(context.globalStorageUri.fsPath, 'codex'),
  }) }]]);
  const currentAgent = () => agents.get(config().get<string>('agent', 'codex')) ?? agents.get('codex')!;
  const rebuild = () => {
    const nodes = browser.inTree ? [...browser.forest.nodes.values()].map(node => ({ ...node, parentId: browser.forest.parents.get(node.id) ?? null }))
      : browser.sessions;
    graph.update({ type: 'snapshot', selectedId: browser.selectedId ?? null, locale: vscode.env.language, agentLabel: currentAgent().label, nodes,
      message: readError ?? (!loaded ? vscode.l10n.t('Loading conversations…') : nodes.length ? undefined : browser.inTree
        ? vscode.l10n.t('This conversation is no longer in the local index. Return to the list or refresh.')
        : vscode.l10n.t('No local sessions found. Check the Codex data folder in SessionTree settings.')),
      labels: { title: vscode.l10n.t('Conversation fork graph. Drag to pan; scroll to zoom.'), listTitle: vscode.l10n.t('Conversations'),
        zoomIn: vscode.l10n.t('Zoom in'), zoomOut: vscode.l10n.t('Zoom out'), fit: vscode.l10n.t('Fit entire tree'),
        locate: vscode.l10n.t('Locate selected conversation'), selected: vscode.l10n.t('Selected'), archived: vscode.l10n.t('Archived'),
        missing: vscode.l10n.t('Source session unavailable'), origin: vscode.l10n.t('Origin'), updated: vscode.l10n.t('Updated'),
        firstReply: vscode.l10n.t('First {0} reply', currentAgent().label), loadingReply: vscode.l10n.t('Loading first reply…'),
        user: vscode.l10n.t('User'), emptyUser: vscode.l10n.t('No readable user message.'),
        emptyReply: vscode.l10n.t('No readable assistant reply yet.'), limitedReply: vscode.l10n.t('First reply is beyond the preview read limit.'),
        unavailableReply: vscode.l10n.t('First reply is temporarily unavailable.') } });
  };
  const visible = () => !disposed && vscode.window.state.focused && graph.visible;
  const synchronizeVisibility = () => reader?.setActive(visible());
  const configure = () => {
    reader?.dispose();
    loaded = false;
    readError = undefined;
    browser.backToList();
    browser.replace([]);
    rebuild();
    void vscode.commands.executeCommand('setContext', 'sessionTree.inTree', false);
    reader = new VisibleReader({ create: () => currentAgent().create(), accept: snapshot => {
      if (!snapshot.nodes) return;
      loaded = true;
      readError = undefined;
      browser.replace(snapshot.nodes);
      rebuild();
    }, error: error => {
      log.appendLine(error instanceof Error ? error.message : String(error));
      readError = vscode.l10n.t('Unable to read sessions. Refresh to retry, or check the Codex data folder in settings.');
      rebuild();
    } });
    reader.setActive(visible());
  };
  const navigate = async () => {
    rebuild();
    await vscode.commands.executeCommand('setContext', 'sessionTree.inTree', browser.inTree);
  };
  context.subscriptions.push(log, graph, { dispose: () => { disposed = true; reader?.dispose(); } },
    vscode.window.registerWebviewViewProvider('sessionTree.explorer', graph, { webviewOptions: { retainContextWhenHidden: false } }),
    graph.onDidChangeVisibility(synchronizeVisibility),
    vscode.window.onDidChangeWindowState(synchronizeVisibility),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('sessionTree')) configure(); }),
    vscode.commands.registerCommand('sessionTree.refresh', async () => {
      if (!graph.visible) { await vscode.commands.executeCommand('sessionTree.explorer.focus'); return; }
      await reader.refresh();
    }),
    vscode.commands.registerCommand('sessionTree.openTree', async (sessionId?: string) => {
      if (typeof sessionId !== 'string' || !browser.openTree(sessionId)) return;
      await navigate();
    }),
    vscode.commands.registerCommand('sessionTree.backToList', async () => {
      browser.backToList(); await navigate();
    }),
    vscode.commands.registerCommand('sessionTree.openConversation', async (sessionId?: string) => {
      const node = typeof sessionId === 'string' ? browser.forest.nodes.get(sessionId) : undefined;
      const agent = currentAgent();
      if (disposed || openingConversation || !graph.visible || !browser.inTree || !node?.nativeId || node.agent !== agent.id
        || node.archived || node.missing || node.subagent || !agent.open) return;
      openingConversation = true;
      try {
        if (!await agent.open(node)) throw new Error('The Codex session link was not opened.');
      } catch (error) {
        log.appendLine(error instanceof Error ? error.message : String(error));
        void vscode.window.showWarningMessage(vscode.l10n.t('Unable to open this conversation in Codex. Make sure the Codex extension is installed and enabled.'));
      } finally { openingConversation = false; }
    }),
    vscode.commands.registerCommand('sessionTree.selectAgent', async () => {
      const selected = await vscode.window.showQuickPick([...agents.values()].map(agent => ({ label: agent.label, id: agent.id })),
        { placeHolder: vscode.l10n.t('Select an agent') });
      if (selected) await config().update('agent', selected.id, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('sessionTree.copyId', async (input?: SessionNode | { sessionTreeNodeId?: string }) => {
      if (!input || typeof input !== 'object') return;
      const id = input && 'sessionTreeNodeId' in input ? input.sessionTreeNodeId : input && 'id' in input ? input.id : undefined;
      const node = typeof id === 'string' ? browser.getNode(id) : undefined;
      if (node?.nativeId && !node.missing) await vscode.env.clipboard.writeText(node.nativeId);
    }));
  void vscode.commands.executeCommand('setContext', 'sessionTree.multipleAgents', agents.size > 1);
  configure();
}
