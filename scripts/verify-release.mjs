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
import { hostTarget } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(join(root, 'plugins/session-tree/plugin.json'), 'utf8'));
const platform = hostTarget();
const candidate = join(root, 'dist', 'session-tree-' + source.version + '-' + platform.platform);
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
  assert.equal(metadata.target, target, 'Use the package built for this operating system and architecture.');
  assert.equal(metadata.format, 3);
  const archiveSha256 = await hash(archive);
  assert.equal(archiveSha256, (await readFile(archive + '.sha256', 'utf8')).split(/\s+/)[0]);
  const entries = await zipEntries(archive);
  assert.ok(entries.some(entry => entry.name === 'plugin.json'));
  assert.ok(!entries.some(entry => /(^|\/)(\.agents|auth\.json|skills|\.session-tree|client-integration)(\/|$)/.test(entry.name)));
  assert.equal(entries.find(entry => entry.name === metadata.entry).mode & 0o111, 0o111);
  assert.ok(!entries.some(entry => /(^|\/)(node_modules|runtime|src)(\/|$)|node\.exe$/.test(entry.name)));
  checks.push('The platform ZIP passes checksum, minimal single-plugin inventory and executable-bit checks; no Node runtime is shipped.');
  const base = join(root, '.session-tree/release-verification');
  await mkdir(base, { recursive: true });
  const work = await mkdtemp(join(base, 'native-'));
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
    if (process.platform === 'darwin') assert.ok((await stat(join(plugin, metadata.entry))).mode & 0o111);
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
    command('git', ['-C', repository, 'update-index', '--chmod=+x', 'plugins/session-tree/' + metadata.entry]);
    command('git', ['-C', repository, '-c', 'user.name=SessionTree packaging test', '-c', 'user.email=packaging-test@localhost', 'commit', '-m', 'Synthetic marketplace fixture']);
    cli(['plugin', 'marketplace', 'add', 'https://session-tree.invalid/marketplace.git', '--ref', 'main', '--json']);
    cli(['plugin', 'add', 'session-tree@session-tree', '--json']);
    const installed = cli(['plugin', 'list', '--json']).installed.find(plugin => plugin.pluginId === 'session-tree@session-tree');
    assert.equal(installed?.enabled, true); assert.equal(installed.version, source.version);
    const installedRoot = join(home, 'plugins/cache/session-tree/session-tree', source.version);
    for (const [file, expected] of Object.entries(metadata.files).filter(([file]) => file.startsWith('plugins/session-tree/'))) {
      assert.equal(await hash(join(installedRoot, file.slice('plugins/session-tree/'.length))), expected, 'Installed ' + file);
    }
    checks.push('Codex installs the platform ZIP payload through an isolated Git marketplace with executable permissions preserved.');
    const servers = cli(['mcp', 'list', '--json']);
    const server = servers.find(server => server.transport?.command?.replaceAll('\\', '/').endsWith('/' + metadata.entry));
    assert.ok(server?.enabled, 'Codex did not resolve the native executable.');
    const transport = server.transport;
    assert.equal(resolve(transport.command), join(installedRoot, metadata.entry));
    await mkdir(transport.cwd, { recursive: true });
    const launchEnv = { ...env, ...transport.env, PATH: process.platform === 'win32' ? '' : '/usr/bin:/bin' };
    assert.equal(run(transport.command, ['--version'], { cwd: transport.cwd, env: launchEnv }).trim(), 'session-tree ' + source.version);
    assert.equal(await hash(transport.command), metadata.files['plugins/session-tree/' + metadata.entry]);
    const bytes = await readFile(transport.command);
    if (process.platform === 'win32') {
      const pe = bytes.readUInt32LE(0x3c);
      assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Expected a Windows x64 executable.');
      const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24;
      assert.equal(bytes.readUInt16LE(optional), 0x20b);
      const sectionTable = optional + optionalSize;
      const offset = rva => {
        for (let i = 0; i < sections; i++) {
          const section = sectionTable + i * 40, address = bytes.readUInt32LE(section + 12);
          const length = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
          if (rva >= address && rva < address + length) return bytes.readUInt32LE(section + 20) + rva - address;
        }
        throw new Error('Invalid PE import address');
      };
      let cursor = offset(bytes.readUInt32LE(optional + 120));
      const libraries = [];
      while (bytes.readUInt32LE(cursor + 12)) {
        const name = offset(bytes.readUInt32LE(cursor + 12));
        libraries.push(bytes.subarray(name, bytes.indexOf(0, name)).toString('ascii'));
        cursor += 20;
      }
      assert.ok(!libraries.some(name => /^(vcruntime|msvcp|sqlite|zstd|node)/i.test(name)), libraries.join(', '));
      checks.push('Windows PE imports confirm the C/C++ runtime, SQLite and Zstandard need no separate DLLs.');
    } else {
      assert.equal(bytes.readUInt32LE(0), 0xfeedfacf);
      assert.equal(bytes.readUInt32LE(4), process.arch === 'arm64' ? 0x100000c : 0x1000007);
      const libraries = run('/usr/bin/otool', ['-L', transport.command]).trim().split('\n').slice(1).map(line => line.trim().split(' ')[0]);
      assert.ok(libraries.every(path => path.startsWith('/usr/lib/') || path.startsWith('/System/Library/')), libraries.join(', '));
      checks.push('macOS Mach-O architecture and system-only dynamic library imports are verified.');
    }
    checks.push('The native executable starts with Node and Rust tools absent from PATH.');
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const sessions = join(home, 'sessions/2026/10/25'); await mkdir(sessions, { recursive: true });
    const paths = ids.map((id, index) => join(sessions, 'rollout-' + id + '.jsonl' + (index ? '.zst' : '')));
    for (let index = 0; index < ids.length; index++) {
      const content = [
        { type: 'session_meta', payload: { id: ids[index], timestamp: '2026-10-25T00:00:00Z', cwd: work, source: 'vscode', ...(index ? { forked_from_id: ids[0] } : {}) } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Native package fixture' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'React tree fixture' } },
      ].map(item => JSON.stringify(item)).join('\n') + '\n';
      await writeFile(paths[index], index ? zstdCompressSync(Buffer.from(content)) : content);
    }
    const db = new DatabaseSync(join(home, 'state_5.sqlite'));
    try {
      db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)');
      ids.forEach((id, index) => db.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run(id, paths[index], 'Native fixture ' + index));
    } finally { db.close(); }
    const requests = [
      { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'native-package-check', version: '1' } } },
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
    assert.ok(tree.nodes.some(node => node.latestMessages.user === 'Native package fixture'));
    checks.push('The packaged MCP serves the self-contained React document and indexes SQLite, plain and Zstandard-compressed synthetic conversations.');
    command(codex, ['plugin', 'remove', 'session-tree@session-tree']);
    command(codex, ['plugin', 'marketplace', 'remove', 'session-tree']);
    checks.push('Uninstall succeeds in the isolated profile; no real account or model API is used.');
    const report = { passed: true, version: source.version, target, archiveSha256, checkedAt: new Date().toISOString(),
      backend: 'rust', checks, nativeDesktopImportVerified: false,
      scope: 'Actual native executable and Codex CLI/MCP behavior. Native client import and UI placement still require a real host acceptance check.' };
    await writeFile(candidate + '.' + target + '.verification.json', JSON.stringify(report, null, 2) + '\n');
    await writeFile(candidate + '.verification.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2)); passed = true;
  } finally { if (passed) await rm(inside(base, work), { recursive: true, force: true }); else console.error('Failed fixture preserved at: ' + work); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
