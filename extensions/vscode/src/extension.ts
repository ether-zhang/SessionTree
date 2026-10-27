import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from './agents/codex';
import { SessionForest } from './tree';
import { VisibleReader } from './reader';
import { Agent, SessionNode } from './types';

class Tree implements vscode.TreeDataProvider<SessionNode> {
  private readonly changed = new vscode.EventEmitter<SessionNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  forest = new SessionForest([], [], false);
  replace(forest: SessionForest): void { this.forest = forest; this.changed.fire(undefined); }
  getChildren(node?: SessionNode): SessionNode[] { return node ? this.forest.children.get(node.id) ?? [] : this.forest.roots; }
  getParent(node: SessionNode): SessionNode | undefined { return this.forest.nodes.get(this.forest.parents.get(node.id) ?? ''); }
  getTreeItem(node: SessionNode): vscode.TreeItem {
    const label = node.missing ? vscode.l10n.t('Source session unavailable') : node.title.replace(/[\r\n\t]/g, ' ').slice(0, 180);
    const item = new vscode.TreeItem(label, this.getChildren(node).length
      ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.archived ? vscode.l10n.t('Archived') : undefined;
    item.iconPath = new vscode.ThemeIcon(node.missing ? 'question' : node.archived ? 'archive' : 'comment-discussion');
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(label);
    if (node.workspace) tooltip.appendText('\n\n' + node.workspace);
    if (node.nativeId) tooltip.appendText('\n\n' + node.nativeId);
    tooltip.isTrusted = false;
    item.tooltip = tooltip;
    item.contextValue = node.nativeId && !node.missing ? 'sessionTree.session' : 'sessionTree.placeholder';
    // Display-only preview: no row command or inferred active conversation.
    return item;
  }
  dispose(): void { this.changed.dispose(); }
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('SessionTree');
  const tree = new Tree();
  const view = vscode.window.createTreeView('sessionTree.explorer', { treeDataProvider: tree, showCollapseAll: true });
  let records: SessionNode[] = [];
  let reader: VisibleReader;
  const config = () => vscode.workspace.getConfiguration('sessionTree');
  const folders = () => (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file' || vscode.env.remoteName)
    .map(folder => folder.uri.fsPath);
  const agents = new Map<string, Agent>([['codex', { id: 'codex', label: 'Codex', create: () => new CodexProvider({
    binary: join(context.extensionPath, 'bin', 'session-tree' + (process.platform === 'win32' ? '.exe' : '')),
    home: config().get<string>('codexHome')?.trim() || process.env.CODEX_HOME || join(homedir(), '.codex'),
    data: join(context.globalStorageUri.fsPath, 'codex'),
  }) }]]);
  const currentAgent = () => agents.get(config().get<string>('agent', 'codex')) ?? agents.get('codex')!;
  const rebuild = () => {
    tree.replace(new SessionForest(records, folders(), config().get<string>('scope', 'workspace') === 'workspace'));
    const count = [...tree.forest.nodes.values()].filter(node => !node.missing).length;
    view.description = currentAgent().label;
    view.badge = count ? { value: count, tooltip: vscode.l10n.t('{0} sessions', count) } : undefined;
    view.message = count ? undefined : config().get<string>('scope', 'workspace') === 'workspace'
      ? vscode.l10n.t('No sessions in this workspace. Use the globe button to show all local sessions.')
      : vscode.l10n.t('No local sessions found. You can set the Codex data folder in SessionTree settings.');
  };
  const visible = () => view.visible && vscode.window.state.focused
    && (config().get<string>('scope', 'workspace') === 'all' || folders().length > 0);
  const configure = () => {
    reader?.dispose();
    records = [];
    rebuild();
    reader = new VisibleReader({ create: () => currentAgent().create(), accept: snapshot => {
      if (!snapshot.nodes) return;
      records = snapshot.nodes;
      rebuild();
    }, error: error => {
      log.appendLine(error instanceof Error ? error.message : String(error));
      view.message = vscode.l10n.t('Unable to read sessions. Refresh to retry, or check the Codex data folder in settings.');
    } });
    reader.setActive(visible());
  };
  context.subscriptions.push(log, tree, view, { dispose: () => reader?.dispose() },
    view.onDidChangeVisibility(() => reader.setActive(visible())),
    vscode.window.onDidChangeWindowState(() => reader.setActive(visible())),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { rebuild(); reader.setActive(visible()); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('sessionTree')) configure(); }),
    vscode.commands.registerCommand('sessionTree.refresh', async () => {
      if (!view.visible) { await vscode.commands.executeCommand('sessionTree.explorer.focus'); return; }
      await reader.refresh();
    }),
    vscode.commands.registerCommand('sessionTree.showAll', () => config().update('scope', 'all', vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('sessionTree.showWorkspace', () => config().update('scope', 'workspace', vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('sessionTree.selectAgent', async () => {
      const selected = await vscode.window.showQuickPick([...agents.values()].map(agent => ({ label: agent.label, id: agent.id })),
        { placeHolder: vscode.l10n.t('Select an agent') });
      if (selected) await config().update('agent', selected.id, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('sessionTree.copyId', async (node?: SessionNode) => {
      if (node?.nativeId && tree.forest.nodes.get(node.id) === node) await vscode.env.clipboard.writeText(node.nativeId);
    }));
  void vscode.commands.executeCommand('setContext', 'sessionTree.multipleAgents', agents.size > 1);
  configure();
}
