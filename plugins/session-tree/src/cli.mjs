#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from './adapters/codex.mjs';
import { TreeService, summary } from './service.mjs';

export function configuration(args = []) {
  const values = { codexHome: process.env.SESSION_TREE_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex'),
    dataDir: process.env.SESSION_TREE_DATA || process.env.PLUGIN_DATA || resolve('.session-tree') };
  for (let i = 0; i < args.length; i++) {
    const name = { '--codex-home': 'codexHome', '--data-dir': 'dataDir' }[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    values[name] = args[++i];
  }
  values.codexHome = resolve(values.codexHome);
  values.dataDir = resolve(values.dataDir);
  return values;
}

export function serviceFor(options) { return new TreeService({ adapter: new CodexAdapter(options.codexHome), dataDir: options.dataDir }); }

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'help' || command === '--help') {
    console.log('SessionTree\n  node src/cli.mjs index [--codex-home PATH] [--data-dir PATH]');
    return;
  }
  if (command !== 'index') throw new Error(`Unknown command: ${command}`);
  const options = configuration(process.argv.slice(3));
  console.log(JSON.stringify({ ...summary(await serviceFor(options).refresh()), indexPath: join(options.dataDir, 'session-tree.index.json') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
