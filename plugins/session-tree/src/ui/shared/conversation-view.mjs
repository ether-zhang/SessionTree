/** UI policy only: preserve the complete generic index and its original parent links. */
export function visibleConversations(index) {
  const nodes = index.nodes.filter(node => !node.subagent);
  if (nodes.length === index.nodes.length) return index;
  const visible = new Set(nodes.map(node => node.id));
  return { ...index, nodes, issues: index.issues.filter(issue => !issue.id || visible.has(issue.id)) };
}

export function previewLines(node, t, assistantLabel = 'Assistant') {
  if (node.summary && !node.latestMessages?.user && !node.latestMessages?.assistant && !node.latestMessage) return [node.summary];
  return ['user', 'assistant'].map(role => {
    const stored = node.latestMessages?.[role];
    // Old saved indexes can still supply their one known role until refreshed.
    const text = typeof stored === 'string' && stored.trim() ? stored :
      node.latestMessage?.role === role && typeof node.latestMessage.text === 'string' ? node.latestMessage.text : null;
    const label = role === 'user' ? t ? t('user') : '用户' : assistantLabel;
    const state = node.previewStatus?.[role];
    const fallback = state === 'limited' ? '未读到较早消息' : state === 'unavailable' ? '消息暂不可读' :
      state === 'empty' ? '尚无消息' : '暂无可读消息';
    const preview = node.missing ? t ? t('none') : '来源会话不可用' : text || (t ? t('none') : fallback);
    return label + (t && !t.locale.startsWith('zh') ? ': ' : '：') + preview;
  });
}
