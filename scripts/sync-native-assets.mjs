import { writeFile } from 'node:fs/promises';
import { tools } from '../plugins/session-tree/src/ui/codex/tool-catalog.mjs';
import { createI18n, supportedUiLocales } from '../plugins/session-tree/src/ui/codex/i18n.mjs';

await writeFile(new URL('../plugins/session-tree/assets/native-catalog.json', import.meta.url), JSON.stringify({
  tools, titles: Object.fromEntries(supportedUiLocales.map(locale => [locale, createI18n(locale).t('title')])),
}, null, 2) + '\n');
