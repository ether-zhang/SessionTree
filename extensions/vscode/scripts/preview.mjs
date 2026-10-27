import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { build, root } from './build.mjs';

await build();
const directory = join(root, '.session-tree/vscode-preview-' + randomUUID().slice(0, 8));
const workspace = join(directory, 'example-project'), home = join(directory, 'mock-codex');
const profile = join(directory, 'profile'), extensions = join(directory, 'extensions');
await mkdir(join(home, 'sessions'), { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(join(profile, 'User'), { recursive: true });
await mkdir(extensions);
await writeFile(join(workspace, 'README.md'), '# SessionTree Preview\n\nSynthetic conversation data only. No account or model API is used.\n');
await writeFile(join(workspace, 'example.ts'), 'export const project = "SessionTree";\n');
await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
  'sessionTree.codexHome': home, 'sessionTree.scope': 'workspace',
  'window.title': 'SessionTree Preview', 'workbench.startupEditor': 'none',
  'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true,
  'workbench.sideBar.location': 'left', 'workbench.activityBar.location': 'default',
  'workbench.colorTheme': 'Default Dark Modern',
}, null, 2));
const db = new DatabaseSync(join(home, 'state_5.sqlite'));
db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,title TEXT,cwd TEXT,source TEXT,archived INTEGER)');
const insert = db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)');
const rows = [
  ['项目规划', null], ['界面设计', 0], ['数据适配', 0], ['初版原型', 0, true], ['VS Code 试用版', 1],
];
const ids = rows.map((_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
for (const [index, [title, parent, archived]] of rows.entries()) {
  const path = join(home, 'sessions', 'rollout-' + ids[index] + '.jsonl');
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: ids[index], cwd: workspace,
    ...(parent === null ? {} : { forked_from_id: ids[parent] }), source: 'vscode' } }) + '\n');
  insert.run(ids[index], path, title, workspace, 'vscode', archived ? 1 : 0);
}
db.close();
const windowsCLI = process.platform === 'win32' ? spawnSync('where.exe', ['code.cmd'], { encoding: 'utf8', windowsHide: true }).stdout?.trim().split(/\r?\n/)[0] : undefined;
const executable = process.env.SESSION_TREE_VSCODE_EXECUTABLE || (process.platform === 'win32'
  ? windowsCLI ? resolve(dirname(windowsCLI), '../Code.exe') : 'Code.exe' : process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/MacOS/Electron' : 'code');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const args = ['--new-window', '--user-data-dir', profile, '--extensions-dir', extensions,
  '--extensionDevelopmentPath=' + resolve(root, 'extensions/vscode'), '--disable-workspace-trust',
  '--disable-extension', 'GitHub.copilot', '--disable-extension', 'GitHub.copilot-chat',
  '--skip-welcome', '--skip-release-notes', workspace];
await writeFile(join(root, '.session-tree/vscode-preview.json'), JSON.stringify({ directory, workspace, home, profile, extensions, executable, args }, null, 2));
const child = spawn(executable, args, { env: environment, detached: true, stdio: 'ignore' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.unref();
console.log(JSON.stringify({ preview: directory, syntheticSessions: rows.length, currentProfileUnchanged: true }, null, 2));
