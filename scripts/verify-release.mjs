import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceManifest = JSON.parse(await readFile(join(root, 'plugins/session-tree/plugin.json'), 'utf8'));
const candidate = join(root, 'dist', `session-tree-${sourceManifest.version}-windows-x64`);
const checks = [];
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
function contained(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error(`Unsafe verification path: ${target}`);
  return resolve(target);
}
function executable(name) {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const path = join(directory, `${name}.exe`);
    if (directory && existsSync(path)) return path;
  }
  throw new Error(`Verification requires ${name}.exe on the builder's PATH.`);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function files(directory) {
  const result = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else { assert.ok(entry.isFile(), `Unexpected entry: ${child}`); result.push(relative(directory, child).replaceAll('\\', '/')); }
    }
  }
  await visit(directory);
  return result.sort();
}
async function verifyFiles(directory, release) {
  assert.deepEqual(await files(directory), [...Object.keys(release.files), 'release.json'].sort());
  for (const [file, expected] of Object.entries(release.files)) assert.equal(await hash(contained(directory, join(directory, file))), expected, file);
}

async function main() {
  const release = JSON.parse(await readFile(join(candidate, 'release.json'), 'utf8'));
  assert.equal(release.platform, 'windows-x64');
  await verifyFiles(candidate, release);
  assert.equal(await hash(`${candidate}.zip`), (await readFile(`${candidate}.zip.sha256`, 'utf8')).split(/\s+/)[0]);
  assert.ok(!Object.keys(release.files).some(path => /(^|\/)(skills|client-integration|\.session-tree|node_modules|auth\.json)(\/|$)|thread-popover|client-family-adapter/.test(path)));
  checks.push('Package checksums match; no local conversations, caches, test Skills, or retired client experiments are included.');
  const workRoot = join(root, '.session-tree', 'release-verification');
  await mkdir(workRoot, { recursive: true });
  const work = await mkdtemp(join(workRoot, 'candidate-'));
  let completed = false;
  try {
    const extracted = join(work, 'extracted');
    await mkdir(extracted);
    run(executable('tar'), ['-xf', `${candidate}.zip`, '-C', extracted]);
    await verifyFiles(extracted, release);
    checks.push('The distributable ZIP preserves the hidden marketplace catalog and all package files.');

    const git = executable('git'), codex = executable('codex');
    const repository = join(work, 'marketplace repository'), home = join(work, 'isolated codex home');
    await mkdir(repository); await mkdir(home);
    // The temporary Git fixture contains package files only. No project README is committed.
    await cp(join(extracted, '.agents'), join(repository, '.agents'), { recursive: true });
    await cp(join(extracted, 'plugins'), join(repository, 'plugins'), { recursive: true });
    await cp(join(extracted, '.gitattributes'), join(repository, '.gitattributes'));
    const emptyGitConfig = join(work, 'empty.gitconfig');
    await writeFile(emptyGitConfig, '');
    const env = { ...process.env, CODEX_HOME: home, SESSION_TREE_CODEX_HOME: home,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(repository).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://session-tree.invalid/marketplace.git', GIT_ALLOW_PROTOCOL: 'file',
    };
    delete env.NODE_OPTIONS; delete env.NODE_PATH;
    // Codex and Git are builder tools. The install and plugin must not find system Node.
    for (const key of Object.keys(env).filter(key => key.toLowerCase() === 'path')) delete env[key];
    env.PATH = (process.env.PATH || '').split(delimiter).filter(path => path && !existsSync(join(path, 'node.exe'))).join(delimiter);
    assert.ok(!env.PATH.split(delimiter).some(path => existsSync(join(path, 'node.exe'))));
    const command = (exe, args) => run(exe, args, { cwd: work, env });
    const cli = args => JSON.parse(command(codex, args));
    command(git, ['init', '-b', 'main', repository]);
    run(git, ['-C', repository, '-c', 'core.autocrlf=true', 'add', '--', '.agents', 'plugins', '.gitattributes'], { env });
    run(git, ['-C', repository, '-c', 'user.name=SessionTree packaging test', '-c', 'user.email=packaging-test@localhost',
      'commit', '-m', 'Temporary local installation fixture'], { env });
    cli(['plugin', 'marketplace', 'add', 'https://session-tree.invalid/marketplace.git', '--ref', 'main', '--json']);
    const id = `${release.plugin}@${release.marketplace}`;
    cli(['plugin', 'add', id, '--json']);
    const installed = cli(['plugin', 'list', '--json']).installed.find(plugin => plugin.pluginId === id);
    assert.equal(installed?.enabled, true); assert.equal(installed.version, release.version);
    const installedRoot = join(home, 'plugins', 'cache', release.marketplace, release.plugin, installed.version);
    for (const [file, expected] of Object.entries(release.files).filter(([file]) => file.startsWith('plugins/session-tree/'))) {
      assert.equal(await hash(join(installedRoot, file.slice('plugins/session-tree/'.length))), expected, `Installed ${file}`);
    }
    checks.push('Codex clones a Git marketplace snapshot and installs/enables the bundled package with system Node removed from PATH.');

    const servers = cli(['mcp', 'list', '--json']);
    const server = servers.find(server => server.transport?.command?.replaceAll('\\', '/').includes('/runtime/node.exe'));
    assert.ok(server?.enabled, 'Codex did not load the installed MCP launcher.');
    const transport = server.transport;
    assert.equal(resolve(transport.command), join(installedRoot, 'runtime', 'node.exe'));
    assert.ok(!JSON.stringify(transport).includes('${PLUGIN_'), 'Codex did not expand the plugin paths.');
    assert.equal(await hash(transport.command), release.runtime.executableSha256);
    await mkdir(transport.cwd, { recursive: true });
    const launchEnv = { ...env, ...transport.env, PATH: '' };
    const probe = JSON.parse(run(transport.command, ['--input-type=module', '-e',
      "import {DatabaseSync} from 'node:sqlite';import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';const db=new DatabaseSync(':memory:');const sqlite=db.prepare('select 42 as value').get().value;db.close();console.log(JSON.stringify({version:process.version,sqlite,zstd:zstdDecompressSync(zstdCompressSync(Buffer.from('ok'))).toString()}));"], { env: launchEnv }));
    assert.deepEqual(probe, { version: `v${release.runtime.version}`, sqlite: 42, zstd: 'ok' });
    checks.push('The launcher resolved by Codex runs the verified bundled runtime with an empty PATH, including SQLite and Zstandard support.');

    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const sessions = join(home, 'sessions', '2026', '10', '17');
    await mkdir(sessions, { recursive: true });
    const paths = ids.map((id, i) => join(sessions, `rollout-${id}.jsonl${i ? '.zst' : ''}`));
    for (let i = 0; i < ids.length; i++) {
      const content = [
        { type: 'session_meta', payload: { id: ids[i], timestamp: '2026-10-17T00:00:00Z', cwd: work, source: 'vscode', ...(i ? { forked_from_id: ids[0] } : {}) } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Portable install works' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Runtime included' } },
      ].map(record => JSON.stringify(record)).join('\n') + '\n';
      await writeFile(paths[i], i ? zstdCompressSync(Buffer.from(content)) : content);
    }
    const db = new DatabaseSync(join(home, 'state_5.sqlite'));
    try {
      db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)');
      ids.forEach((id, i) => db.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run(id, paths[i], `Packaged conversation ${i + 1}`));
    } finally { db.close(); }
    const requests = [
      { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'release-verification', version: '1' }, _meta: { 'openai/locale': 'en-US' } } },
      { method: 'tools/list' },
      { method: 'resources/read', params: { uri: 'ui://session-tree/conversation-button.html' } },
      { method: 'tools/call', params: { name: 'open_session_tree_button', arguments: {}, _meta: { threadId: ids[1] } } },
    ];
    const replies = run(transport.command, transport.args, { cwd: transport.cwd, env: launchEnv,
      input: requests.map((call, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...call })).join('\n') + '\n',
    }).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(replies.length, requests.length);
    replies.forEach(reply => { assert.ok(!reply.error, JSON.stringify(reply.error)); assert.ok(!reply.result.isError, JSON.stringify(reply.result.content)); });
    assert.equal(replies[0].result.serverInfo.version, release.version);
    const button = replies[1].result.tools.find(tool => tool.name === 'open_session_tree_button');
    assert.deepEqual(button._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
    assert.ok(replies[2].result.contents[0].text.includes('<script type="module">'));
    const tree = replies[3].result._meta.sessionTreePanel.index;
    assert.equal(tree.currentId, `codex:${ids[1]}`); assert.equal(tree.nodes.length, 2);
    assert.ok(tree.nodes.some(node => node.title === 'Packaged conversation 2' && node.latestMessages.user === 'Portable install works'));
    checks.push('The installed MCP serves the native conversation entry and UI, and reads a two-node tree from fixture SQLite and compressed logs.');

    command(codex, ['plugin', 'remove', id]);
    assert.ok(!cli(['plugin', 'list', '--json']).installed.some(plugin => plugin.pluginId === id));
    command(codex, ['plugin', 'marketplace', 'remove', release.marketplace]);
    checks.push('Uninstall and marketplace removal succeed in the isolated Codex profile; the active installation is untouched.');
    const report = { passed: true, version: release.version, platform: release.platform, runtime: probe.version,
      archiveSha256: await hash(`${candidate}.zip`), codexCli: command(codex, ['--version']).trim(),
      checkedAt: new Date().toISOString(), checks,
      scope: 'Official Codex CLI and installed MCP launch; native desktop Install click and a remote hosted repository have not been exercised.',
    };
    await writeFile(`${candidate}.verification.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2)); completed = true;
  } finally {
    if (completed) await rm(contained(workRoot, work), { recursive: true, force: true });
    else console.error(`Failed verification fixture preserved at: ${work}`);
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
