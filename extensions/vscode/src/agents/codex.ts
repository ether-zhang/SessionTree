import { stat } from 'node:fs/promises';
import { BackendClient } from '../backend';
import { FirstReply, SessionProvider, Snapshot, SessionNode } from '../types';

export class CodexProvider implements SessionProvider {
  private client?: BackendClient;
  private disposed = false;
  private initialization?: Promise<void>;

  constructor(private readonly options: { binary: string; home: string; data: string }) {}

  async read(opening: boolean, sinceRevision?: string): Promise<Snapshot> {
    try { await stat(this.options.home); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 'missing-home', nodes: [] };
      throw error;
    }
    if (this.disposed) throw new Error('The session reader is closed.');
    if (!this.client) {
      this.client = new BackendClient(this.options.binary, this.options.home, this.options.data);
      this.initialization = this.client.initialize();
    }
    try { await this.initialization; }
    catch (error) { this.dispose(); throw error; }
    if (this.disposed || !this.client) throw new Error('The session reader is closed.');
    const result = await this.client.request('tools/call', { name: 'session_tree_panel_data', arguments: {
      open_check: opening, ...(sinceRevision ? { since_revision: sinceRevision } : {}),
    } });
    if (result.isError) {
      this.dispose();
      throw new Error(result.content?.find((item: any) => item.type === 'text')?.text ?? 'Unable to read Codex sessions.');
    }
    const unchanged = result._meta?.sessionTreeUnchanged;
    if (typeof unchanged?.revision === 'string') return { revision: unchanged.revision };
    const panel = result._meta?.sessionTreePanel;
    if (typeof panel?.revision !== 'string' || !Array.isArray(panel?.index?.nodes)) throw new Error('Invalid Codex session metadata.');
    const nodes: SessionNode[] = panel.index.nodes.filter((node: any) => typeof node.id === 'string'
      && typeof node.agent === 'string' && typeof node.title === 'string')
      .map((node: SessionNode) => ({ id: node.id, agent: node.agent, nativeId: node.nativeId,
        parentId: node.parentId, title: node.title, workspace: node.workspace ?? '',
        createdAt: node.createdAt, updatedAt: node.updatedAt,
        archived: Boolean(node.archived), missing: Boolean(node.missing), subagent: Boolean(node.subagent) }));
    return { revision: panel.revision, nodes };
  }

  async firstReply(nativeId: string): Promise<FirstReply> {
    const client = this.client;
    if (this.disposed || !client) return { status: 'unavailable' };
    await this.initialization;
    if (this.disposed || client !== this.client) return { status: 'unavailable' };
    const result = await client.request('sessionTree/firstReply', { threadId: nativeId });
    if (!['available', 'empty', 'limited', 'unavailable'].includes(result?.status)
      || result.user !== undefined && typeof result.user !== 'string'
      || result.status === 'available' && typeof result.text !== 'string') return { status: 'unavailable' };
    return result;
  }

  dispose(): void { this.disposed = true; this.client?.dispose(); this.client = undefined; this.initialization = undefined; }
}
