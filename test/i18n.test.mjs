import test from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, supportedUiLocales } from '../plugins/session-tree/src/ui/codex/i18n.mjs';
import { messagePreviewLines } from '../plugins/session-tree/src/ui/codex/conversation-view.mjs';

test('UI copy covers each bundled locale, with regional/script matching and safe fallback', () => {
  const keys = 'title search chats fit locate current selected archived user refresh zoom expand collapse choose none loading error'.split(' ');
  for (const locale of supportedUiLocales) {
    const ui = createI18n(locale);
    for (const key of keys) assert.ok(ui.t(key) && ui.t(key) !== key, locale + ': ' + key);
  }
  for (const [requested, expected] of [['en-US', 'en'], ['de-DE', 'de'], ['zh-CN', 'zh-Hans'],
    ['zh-HK', 'zh-Hant'], ['zh-Hans-TW', 'zh-Hans'], ['pt-PT', 'pt-PT'], ['sr-Latn-RS', 'sr-Latn'], ['no-NO', 'nb'],
    ['xx-ZZ', 'en'], ['not_a_locale!', 'en']]) assert.equal(createI18n(requested).locale, expected);
  assert.equal(createI18n('ar-SA').dir, 'rtl');
});

test('localized labels preserve user-authored titles and message text', () => {
  const node = { title: '原始标题', latestMessages: { user: '保留中文正文 [图片]', assistant: 'Original answer' } };
  const ui = createI18n('en-US');
  assert.deepEqual(messagePreviewLines(node, ui.t), ['User: 保留中文正文 [图片]', 'Codex: Original answer']);
  assert.equal(node.title, '原始标题');
  assert.equal(createI18n('zh-CN').count(5), '5 个会话');
});
