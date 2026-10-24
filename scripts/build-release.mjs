import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import assert from 'node:assert/strict';
import { zipDirectory, zipEntries } from './lib/archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), dist = join(root, 'dist');
const source = join(root, 'plugins/session-tree');
const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
const runtimeLock = JSON.parse(await readFile(join(root, 'packaging/node-runtimes.json'), 'utf8'));
const output = join(dist, 'session-tree-' + manifest.version + '-universal');
const pluginZip = output + '-plugin.zip', marketZip = output + '-marketplace.zip';
const production = [
  'LICENSE', 'assets/session-tree.svg', 'assets/session-tree.png', 'assets/panel.html', 'assets/frontend-licenses.txt',
  'src/cli.mjs', 'src/service.mjs', 'src/core/tree.mjs', 'src/core/layout.mjs', 'src/core/store.mjs',
  'src/adapters/codex.mjs', 'src/adapters/codex-preview.mjs', 'src/adapters/codex-changes.mjs',
  ...['mcp.mjs', 'resource.mjs', 'panel-model.mjs', 'conversation-view.mjs', 'i18n.mjs'].map(file => 'src/ui/codex/' + file),
];
const json = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
function contained(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child), 'Unsafe build path');
  return target;
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
async function copy(from, to) {
  assert.ok((await lstat(from)).isFile());
  await mkdir(join(to, '..'), { recursive: true }); await copyFile(from, to);
}
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function fingerprints(directory) {
  const result = {};
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { assert.ok(entry.isFile()); result[relative(directory, file).replaceAll('\\', '/')] = await hash(file); }
    }
  }
  await visit(directory); return result;
}
async function download(runtime, cache) {
  const file = join(cache, runtime.archive);
  if (await exists(file) && await hash(file) === runtime.sha256) return file;
  console.log('Downloading official ' + runtime.archive);
  const response = await fetch(runtime.url, { signal: AbortSignal.timeout(180000) });
  assert.ok(response.ok, runtime.url + ': HTTP ' + response.status);
  const partial = file + '.partial';
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  assert.equal(await hash(partial), runtime.sha256, 'Runtime archive checksum mismatch');
  await copyFile(partial, file); await rm(partial);
  return file;
}
async function main() {
  assert.ok(process.argv.slice(2).every(arg => arg === '--replace'));
  const targets = [output, pluginZip, pluginZip + '.sha256', marketZip, marketZip + '.sha256', output + '.verification.json'];
  targets.push(output + '.metadata.json');
  if ((await Promise.all(targets.map(exists))).some(Boolean)) {
    assert.ok(process.argv.includes('--replace'), 'Candidate exists. Use --replace to rebuild this version.');
    for (const target of targets) await rm(contained(dist, target), { recursive: true, force: true });
  }
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  run(process.execPath, [join(root, 'scripts/build-ui.mjs')]);
  const plugin = join(output, 'plugins/session-tree'), cache = join(root, '.session-tree/runtime-cache');
  await mkdir(cache, { recursive: true });
  for (const file of production) await copy(join(source, file), join(plugin, file));
  await json(join(plugin, 'plugin.json'), manifest);
  const mcp = JSON.parse(await readFile(join(source, 'mcp.json'), 'utf8'));
  mcp.mcpServers['session-tree'].command = './runtime/node';
  await json(join(plugin, 'mcp.json'), mcp);
  for (const runtime of runtimeLock.runtimes) {
    const archive = await download(runtime, cache);
    if (runtime.platform === 'win32') {
      const scratch = await mkdtemp(join(cache, 'inspect-win-'));
      try {
        const prefix = runtime.archive.replace(/\.zip$/, '');
        run('tar', ['-xf', archive, '-C', scratch, prefix + '/node.exe', prefix + '/LICENSE']);
        assert.equal(await hash(join(scratch, prefix, 'node.exe')), runtime.executableSha256);
        await copy(join(scratch, prefix, 'node.exe'), join(plugin, 'runtime/node.exe'));
        await copy(join(scratch, prefix, 'LICENSE'), join(plugin, 'runtime/LICENSE'));
      } finally { await rm(contained(cache, scratch), { recursive: true, force: true }); }
    } else {
      await copy(archive, join(plugin, 'runtime', runtime.archive));
      await writeFile(join(plugin, 'runtime', runtime.id + '.meta'),
        [runtime.archive, runtime.sha256, runtime.executableSha256, runtime.prefix, ''].join('\n'));
    }
  }
  await copy(join(root, 'packaging/launch-node.sh'), join(plugin, 'runtime/node'));
  await chmod(join(plugin, 'runtime/node'), 0o755);
  await writeFile(join(plugin, 'THIRD_PARTY_NOTICES.md'),
    '# Third-party components\n\nThis package includes the unmodified official Node.js ' + runtimeLock.version +
    ' Windows x64 executable and official macOS arm64/x64 archives. Every archive is SHA-256 pinned. macOS expands its bundled archive locally into PLUGIN_DATA on first use; no runtime download or system installation occurs.\n\n' +
    'The complete Node.js license is in runtime/LICENSE and inside each official macOS archive. Runtime sources and checksums:\n\n' +
    runtimeLock.runtimes.map(runtime => '- ' + runtime.url + '\n  SHA-256: ' + runtime.sha256).join('\n') +
    '\n\nBundled React, React DOM and Scheduler licenses are in assets/frontend-licenses.txt. SessionTree is licensed under the included MIT License.\n');
  const market = { name: 'session-tree', interface: { displayName: 'SessionTree' }, plugins: [{
    name: manifest.name, source: { source: 'local', path: './plugins/session-tree' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  }] };
  await mkdir(join(output, '.agents/plugins'), { recursive: true });
  await json(join(output, '.agents/plugins/marketplace.json'), market);
  await copy(join(root, 'packaging/marketplace-readme.md'), join(output, 'README.md'));
  await copy(join(root, 'LICENSE'), join(output, 'LICENSE'));
  await writeFile(join(output, '.gitattributes'), '* -text\n');
  const metadata = { format: 2, plugin: manifest.name, version: manifest.version,
    platform: 'windows-macos', marketplace: market.name, runtimes: runtimeLock.runtimes,
    executableFiles: ['plugins/session-tree/runtime/node'], files: await fingerprints(output) };
  await json(join(output, 'release.json'), metadata);
  await json(output + '.metadata.json', metadata);
  await zipDirectory(plugin, pluginZip, { executablePaths: ['runtime/node', 'runtime/node.exe'] });
  await zipDirectory(output, marketZip, { executablePaths: ['plugins/session-tree/runtime/node', 'plugins/session-tree/runtime/node.exe'] });
  const entries = await zipEntries(pluginZip);
  assert.ok((entries.find(entry => entry.name === 'runtime/node').mode & 0o111) === 0o111, 'macOS launcher is not executable');
  const bytes = (await lstat(pluginZip)).size;
  assert.ok(bytes < 100 * 1024 * 1024, 'Universal package exceeds the client bundle download limit');
  for (const file of [pluginZip, marketZip]) await writeFile(file + '.sha256', await hash(file) + '  ' + file.split(/[\\/]/).at(-1) + '\n');
  console.log(JSON.stringify({ output, pluginZip, marketZip, bytes, sizeMiB: +(bytes / 1024 / 1024).toFixed(1),
    targets: runtimeLock.runtimes.map(runtime => runtime.id), macExecutableBit: true }, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
