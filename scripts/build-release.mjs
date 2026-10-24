import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory, zipEntries } from './lib/archive.mjs';
import { hostTarget } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), dist = join(root, 'dist');
const source = join(root, 'plugins/session-tree');
const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
const target = hostTarget();
const output = join(dist, 'session-tree-' + manifest.version + '-' + target.platform);
const pluginZip = output + '-plugin.zip', marketZip = output + '-marketplace.zip';
const json = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
function inside(parent, path) {
  const child = relative(resolve(parent), resolve(path));
  assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child), 'Unsafe build path');
  return path;
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
async function copy(from, to) {
  assert.ok((await lstat(from)).isFile());
  await mkdir(dirname(to), { recursive: true }); await copyFile(from, to);
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
async function notices() {
  const metadata = JSON.parse(run('cargo', ['metadata', '--format-version=1', '--locked']));
  const sections = ['# Third-party components\n\nSessionTree links SQLite and Zstandard into its Rust executable. SQLite is in the public domain: https://sqlite.org/copyright.html. Other linked crate notices follow. Embedded frontend notices are in assets/frontend-licenses.txt.'];
  for (const pkg of metadata.packages.filter(pkg => !metadata.workspace_members.includes(pkg.id)).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = dirname(pkg.manifest_path);
    const files = (await readdir(path)).filter(file => /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[._-]|$)/i.test(file));
    if (pkg.name === 'zstd-sys' && await exists(join(path, 'zstd/LICENSE'))) files.push('zstd/LICENSE');
    const contents = [];
    for (const file of files) if ((await lstat(join(path, file))).isFile()) contents.push(file + '\n\n' + await readFile(join(path, file), 'utf8'));
    sections.push('## ' + pkg.name + ' ' + pkg.version + '\n\nLicense: ' + pkg.license + '\n' +
      (pkg.repository || 'https://crates.io/crates/' + pkg.name) + '\n\n' + contents.join('\n\n'));
  }
  return sections.join('\n\n---\n\n') + '\n';
}
async function main() {
  assert.ok(process.argv.slice(2).every(arg => arg === '--replace'));
  const paths = [output, pluginZip, pluginZip + '.sha256', marketZip, marketZip + '.sha256', output + '.metadata.json', output + '.verification.json'];
  if ((await Promise.all(paths.map(exists))).some(Boolean)) {
    assert.ok(process.argv.includes('--replace'), 'Candidate exists; use --replace to rebuild this version.');
    for (const path of paths) await rm(inside(dist, path), { recursive: true, force: true });
  }
  const host = run('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1]?.trim();
  assert.equal(host, target.rust, 'Use a native build host for this platform package.');
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  run(process.execPath, [join(root, 'scripts/build-ui.mjs')]);
  run(process.execPath, [join(root, 'scripts/build-backend.mjs')]);
  const plugin = join(output, 'plugins/session-tree');
  for (const file of ['LICENSE', 'assets/session-tree.svg', 'assets/session-tree.png', 'assets/frontend-licenses.txt']) {
    await copy(join(source, file), join(plugin, file));
  }
  await copy(join(source, 'bin', target.binary), join(plugin, 'bin', target.binary));
  await chmod(join(plugin, 'bin', target.binary), 0o755);
  await json(join(plugin, 'plugin.json'), manifest);
  const mcp = JSON.parse(await readFile(join(source, 'mcp.json'), 'utf8'));
  mcp.mcpServers['session-tree'].command = './bin/' + target.binary;
  mcp.mcpServers['session-tree'].args = [];
  await json(join(plugin, 'mcp.json'), mcp);
  await writeFile(join(plugin, 'THIRD_PARTY_NOTICES.txt'), await notices());
  const market = { name: 'session-tree', interface: { displayName: 'SessionTree (' + target.label + ')' }, plugins: [{
    name: manifest.name, source: { source: 'local', path: './plugins/session-tree' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  }] };
  await mkdir(join(output, '.agents/plugins'), { recursive: true });
  await json(join(output, '.agents/plugins/marketplace.json'), market);
  await copy(join(root, 'packaging/marketplace-readme.md'), join(output, 'README.md'));
  await copy(join(root, 'LICENSE'), join(output, 'LICENSE'));
  await writeFile(join(output, '.gitattributes'), '* -text\n');
  const entry = 'bin/' + target.binary;
  const metadata = { format: 3, plugin: manifest.name, version: manifest.version, platform: target.platform,
    target: process.platform + '-' + process.arch, rustTarget: target.rust, entry, marketplace: market.name,
    executableFiles: ['plugins/session-tree/' + entry], files: await fingerprints(output) };
  await json(join(output, 'release.json'), metadata);
  await json(output + '.metadata.json', metadata);
  await zipDirectory(plugin, pluginZip, { executablePaths: [entry] });
  await zipDirectory(output, marketZip, { executablePaths: ['plugins/session-tree/' + entry] });
  const entries = await zipEntries(pluginZip);
  assert.equal(entries.find(file => file.name === entry).mode & 0o111, 0o111);
  assert.ok(!entries.some(file => /(^|\/)(?:node(?:\.exe)?|node_modules|runtime|src)(?:\/|$)/.test(file.name)), 'Native package must not include Node or development source.');
  const bytes = (await lstat(pluginZip)).size;
  for (const file of [pluginZip, marketZip]) await writeFile(file + '.sha256', await hash(file) + '  ' + basename(file) + '\n');
  console.log(JSON.stringify({ output, pluginZip, bytes, sizeMiB: +(bytes / 1024 / 1024).toFixed(2), target: metadata.target, bundledNode: false }, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
