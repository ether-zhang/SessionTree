import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import { zipEntries } from './lib/archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(join(root, 'plugins/session-tree/plugin.json'), 'utf8'));
const candidate = join(root, 'dist', 'session-tree-' + source.version + '-universal');
const archive = candidate + '-plugin.zip';
const checks = [];
const codex = process.env.SESSION_TREE_VERIFY_CODEX || 'codex';
const hash = async file => { const h = createHash('sha256'); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('hex'); };
function inside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child), 'Unsafe verification path');
  return target;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function main() {
  const metadata = JSON.parse(await readFile(candidate + '.metadata.json', 'utf8'));
  const target = process.platform + '-' + process.arch;
  const runtime = metadata.runtimes.find(runtime => runtime.id === target);
  assert.ok(runtime, 'Unsupported verification host: ' + target);
  const archiveSha256 = await hash(archive);
  assert.equal(archiveSha256, (await readFile(archive + '.sha256', 'utf8')).split(/\s+/)[0]);
  const entries = await zipEntries(archive);
  assert.ok(entries.some(entry => entry.name === 'plugin.json'));
  assert.ok(!entries.some(entry => /(^|\/)(\.agents|auth\.json|skills|\.session-tree|client-integration)(\/|$)/.test(entry.name)));
  assert.equal(entries.find(entry => entry.name === 'runtime/node').mode & 0o111, 0o111);
  checks.push('The same universal ZIP passes checksum, single-plugin inventory and Unix executable-bit checks.');
  const base = join(root, '.session-tree/release-verification');
  await mkdir(base, { recursive: true });
  const work = await mkdtemp(join(base, 'universal-'));
  let passed = false;
  try {
    const repository = join(work, 'marketplace repository'), plugin = join(repository, 'plugins/session-tree');
    const home = join(work, 'isolated codex home');
    await mkdir(plugin, { recursive: true }); await mkdir(home);
    run('tar', ['-xf', archive, '-C', plugin]);
    for (const [file, expected] of Object.entries(metadata.files).filter(([file]) => file.startsWith('plugins/session-tree/'))) {
      assert.equal(await hash(join(plugin, file.slice('plugins/session-tree/'.length))), expected, file);
    }
    const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
    assert.equal(manifest.version, source.version);
    if (process.platform === 'darwin') assert.ok((await stat(join(plugin, 'runtime/node'))).mode & 0o111);
    await mkdir(join(repository, '.agents/plugins'), { recursive: true });
    await writeFile(join(repository, '.agents/plugins/marketplace.json'), JSON.stringify({
      name: 'session-tree', plugins: [{ name: 'session-tree', source: { source: 'local', path: './plugins/session-tree' } }],
    }));
    await writeFile(join(repository, '.gitattributes'), '* -text\n');
    const gitConfig = join(work, 'empty.gitconfig'); await writeFile(gitConfig, '');
    const env = { ...process.env, CODEX_HOME: home, SESSION_TREE_CODEX_HOME: home,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.' + pathToFileURL(repository).href + '.insteadOf',
      GIT_CONFIG_VALUE_0: 'https://session-tree.invalid/marketplace.git', GIT_ALLOW_PROTOCOL: 'file',
    };
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CHATGPT_ACCESS_TOKEN']) delete env[key];
    const command = (executable, args, options = {}) => run(executable, args, { cwd: work, env, ...options });
    const cli = args => JSON.parse(command(codex, args));
    command('git', ['init', '-b', 'main', repository]);
    command('git', ['-C', repository, 'add', '--all']);
    command('git', ['-C', repository, 'update-index', '--chmod=+x', 'plugins/session-tree/runtime/node']);
    command('git', ['-C', repository, '-c', 'user.name=SessionTree packaging test', '-c', 'user.email=packaging-test@localhost', 'commit', '-m', 'Synthetic marketplace fixture']);
    cli(['plugin', 'marketplace', 'add', 'https://session-tree.invalid/marketplace.git', '--ref', 'main', '--json']);
    cli(['plugin', 'add', 'session-tree@session-tree', '--json']);
    const installed = cli(['plugin', 'list', '--json']).installed.find(plugin => plugin.pluginId === 'session-tree@session-tree');
    assert.equal(installed?.enabled, true); assert.equal(installed.version, source.version);
    const installedRoot = join(home, 'plugins/cache/session-tree/session-tree', source.version);
    for (const [file, expected] of Object.entries(metadata.files).filter(([file]) => file.startsWith('plugins/session-tree/'))) {
      assert.equal(await hash(join(installedRoot, file.slice('plugins/session-tree/'.length))), expected, 'Installed ' + file);
    }
    checks.push('Codex installs the universal ZIP payload through an isolated Git marketplace with executable permissions preserved.');
    const servers = cli(['mcp', 'list', '--json']);
    const server = servers.find(server => server.transport?.command?.replaceAll('\\', '/').endsWith('/runtime/node'));
    assert.ok(server?.enabled, 'Codex did not resolve the shared launcher.');
    const transport = server.transport;
    assert.equal(resolve(transport.command), join(installedRoot, 'runtime/node'));
    await mkdir(transport.cwd, { recursive: true });
    const launchEnv = { ...env, ...transport.env, PATH: process.platform === 'win32' ? '' : '/usr/bin:/bin' };
    const expression = "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,executable:process.execPath})";
    const cold = JSON.parse(run(transport.command, ['-p', expression], { cwd: transport.cwd, env: launchEnv }));
    assert.equal(cold.version, 'v' + runtime.version); assert.equal(cold.platform, process.platform); assert.equal(cold.arch, process.arch);
    assert.equal(await hash(cold.executable), runtime.executableSha256);
    const before = await stat(cold.executable);
    const warm = JSON.parse(run(transport.command, ['-p', expression], { cwd: transport.cwd, env: launchEnv }));
    const after = await stat(warm.executable);
    assert.equal(warm.executable, cold.executable); assert.equal(after.ino, before.ino); assert.equal(after.birthtimeMs, before.birthtimeMs);
    checks.push('Cold and warm launches select the pinned ' + target + ' runtime with system Node absent from PATH.');
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const sessions = join(home, 'sessions/2026/10/25'); await mkdir(sessions, { recursive: true });
    const paths = ids.map((id, index) => join(sessions, 'rollout-' + id + '.jsonl' + (index ? '.zst' : '')));
    for (let index = 0; index < ids.length; index++) {
      const content = [
        { type: 'session_meta', payload: { id: ids[index], timestamp: '2026-10-25T00:00:00Z', cwd: work, source: 'vscode', ...(index ? { forked_from_id: ids[0] } : {}) } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Universal package fixture' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'React tree fixture' } },
      ].map(item => JSON.stringify(item)).join('\n') + '\n';
      await writeFile(paths[index], index ? zstdCompressSync(Buffer.from(content)) : content);
    }
    const db = new DatabaseSync(join(home, 'state_5.sqlite'));
    try {
      db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)');
      ids.forEach((id, index) => db.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run(id, paths[index], 'Universal fixture ' + index));
    } finally { db.close(); }
    const requests = [
      { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'universal-package-check', version: '1' } } },
      { method: 'tools/list' }, { method: 'resources/read', params: { uri: 'ui://session-tree/conversation-button.html' } },
      { method: 'tools/call', params: { name: 'open_session_tree_button', arguments: {}, _meta: { threadId: ids[1] } } },
    ];
    const replies = run(transport.command, transport.args, { cwd: transport.cwd, env: launchEnv,
      input: requests.map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })).join('\n') + '\n',
    }).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(replies.length, requests.length);
    replies.forEach(reply => { assert.ok(!reply.error, JSON.stringify(reply.error)); assert.ok(!reply.result.isError, JSON.stringify(reply.result.content)); });
    assert.equal(replies[0].result.serverInfo.version, source.version);
    assert.ok(replies[2].result.contents[0].text.includes('<script type="module">'));
    assert.ok(replies[2].result.contents[0].text.includes('id="root"'));
    const tree = replies[3].result._meta.sessionTreePanel.index;
    assert.equal(tree.currentId, 'codex:' + ids[1]); assert.equal(tree.nodes.length, 2);
    assert.ok(tree.nodes.some(node => node.latestMessages.user === 'Universal package fixture'));
    checks.push('The packaged MCP serves the self-contained React document and indexes SQLite, plain and Zstandard-compressed synthetic conversations.');
    command(codex, ['plugin', 'remove', 'session-tree@session-tree']);
    command(codex, ['plugin', 'marketplace', 'remove', 'session-tree']);
    checks.push('Uninstall succeeds in the isolated profile; no real account or model API is used.');
    const report = { passed: true, version: source.version, target, archiveSha256, checkedAt: new Date().toISOString(),
      runtime: cold.version, checks, nativeDesktopImportVerified: false,
      scope: 'Actual packaged runtime and Codex CLI/MCP behavior. Native client import and UI placement still require a real host acceptance check.' };
    await writeFile(candidate + '.' + target + '.verification.json', JSON.stringify(report, null, 2) + '\n');
    await writeFile(candidate + '.verification.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2)); passed = true;
  } finally { if (passed) await rm(inside(base, work), { recursive: true, force: true }); else console.error('Failed fixture preserved at: ' + work); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
