import * as vscode from 'vscode';
import { SessionNode } from '../types';

/** Hand a local thread link to Codex's URI handler; never start an agent process ourselves. */
export async function openCodexConversation(node: SessionNode): Promise<boolean> {
  if (node.agent !== 'codex' || node.archived || node.missing || node.subagent
    || !node.nativeId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(node.nativeId)
    || !vscode.extensions.getExtension('openai.chatgpt')) return false;
  return vscode.env.openExternal(vscode.Uri.from({ scheme: vscode.env.uriScheme, authority: 'openai.chatgpt', path: '/local/' + node.nativeId }));
}
