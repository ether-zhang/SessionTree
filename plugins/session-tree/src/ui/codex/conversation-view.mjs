import { visibleConversations, previewLines } from '../shared/conversation-view.mjs';

export const conversationIndex = visibleConversations;
export function messagePreviewLines(node, t) { return previewLines(node, t, 'Codex'); }
