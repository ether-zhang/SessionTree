import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const pluginSource = join(root, 'plugins', 'session-tree');
const runtime = JSON.parse(await readFile(join(root, 'packaging', 'node-runtime.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(pluginSource, 'plugin.json'), 'utf8'));
const name = `session-tree-${manifest.version}-windows-x64`;
const output = join(dist, name), archive = `${output}.zip`;
const baseUrl = `https://nodejs.org/download/release/v${runtime.version}/`;

// Deliberately include only production dependencies, never the workspace or local data.
const productionFiles = [
  'LICENSE',
  'assets/session-tree.svg', 'assets/session-tree.png',
  'src/cli.mjs', 'src/service.mjs',
  'src/core/tree.mjs', 'src/core/layout.mjs', 'src/core/store.mjs',
  'src/adapters/codex.mjs', 'src/adapters/codex-preview.mjs', 'src/adapters/codex-changes.mjs',
  ...['mcp.mjs', 'resource.mjs', 'panel.mjs', 'panel-model.mjs',
    'transport.mjs', 'conversation-view.mjs', 'i18n.mjs'].map(file => `src/ui/codex/${file}`),
  ...['resource.mjs', 'panel.mjs', 'panel.html', 'panel.css', 'panel-model.mjs',
    'conversation-view.mjs', 'i18n.mjs'].map(file => `src/ui/shared/${file}`),
];

function contained(parent, path) {
  const child = relative(resolve(parent), resolve(path));
  if (!child || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)) throw new Error(`Unsafe build path: ${path}`);
  return resolve(path);
}
async function hash(path) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest('hex');
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function json(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
async function copy(source, target) {
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular release file: ${source}`);
  await mkdir(join(target, '..'), { recursive: true });
  await copyFile(source, target);
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed (${result.status})`);
  return result.stdout;
}
async function fingerprints(directory) {
  const result = {};
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) result[relative(directory, child).replaceAll('\\', '/')] = await hash(child);
      else throw new Error(`Unsupported release entry: ${child}`);
    }
  }
  await visit(directory);
  return result;
}

async function main() {
  if (process.platform !== runtime.platform || process.arch !== runtime.arch) throw new Error('This release builder currently targets Windows x64.');
  if (process.argv.slice(2).some(arg => arg !== '--replace')) throw new Error('Usage: node scripts/build-release.mjs [--replace]');
  if (await exists(output) || await exists(archive)) {
    if (!process.argv.includes('--replace')) throw new Error(`Candidate already exists: ${output}. Use --replace to rebuild it.`);
    // Resolve and check both targets before any recursive deletion.
    const targets = [output, archive, `${archive}.sha256`, `${output}.verification.json`].map(path => contained(dist, path));
    for (const target of targets) await rm(target, { recursive: true, force: true });
  }
  const cache = join(root, '.session-tree', 'runtime-cache');
  await mkdir(cache, { recursive: true });
  const download = join(cache, runtime.archive);
  if (!await exists(download) || await hash(download) !== runtime.sha256) {
    console.error(`Downloading official Node.js ${runtime.version} for the release builder…`);
    const response = await fetch(baseUrl + runtime.archive, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    const partial = `${download}.partial`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      if (await hash(partial) !== runtime.sha256) throw new Error('Node.js archive checksum mismatch.');
      await rename(partial, download);
    } finally { await rm(partial, { force: true }); }
  }
  const scratch = await mkdtemp(join(cache, 'extract-'));
  try {
    const prefix = runtime.archive.replace(/\.zip$/, '');
    run('tar', ['-xf', download, '-C', scratch, `${prefix}/node.exe`, `${prefix}/LICENSE`]);
    const executable = join(scratch, prefix, 'node.exe');
    if (await hash(executable) !== runtime.executableSha256) throw new Error('Extracted Node.js executable checksum mismatch.');
    const version = JSON.parse(run(executable, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})']));
    if (version.version !== `v${runtime.version}` || version.platform !== runtime.platform || version.arch !== runtime.arch) throw new Error('Unexpected bundled runtime.');
    const plugin = join(output, 'plugins', 'session-tree');
    for (const file of productionFiles) await copy(join(pluginSource, file), join(plugin, file));
    await copy(executable, join(plugin, 'runtime', 'node.exe'));
    await copy(join(scratch, prefix, 'LICENSE'), join(plugin, 'runtime', 'LICENSE'));
    const packagedManifest = structuredClone(manifest);
    await json(join(plugin, 'plugin.json'), packagedManifest);
    const mcp = JSON.parse(await readFile(join(pluginSource, 'mcp.json'), 'utf8'));
    // Agent Plugins resolves executable paths only with the contained ./ syntax.
    mcp.mcpServers['session-tree'].command = './runtime/node.exe';
    await json(join(plugin, 'mcp.json'), mcp);
    const market = {
      name: 'session-tree', interface: { displayName: 'SessionTree (Windows x64)' },
      plugins: [{ name: manifest.name, source: { source: 'local', path: './plugins/session-tree' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
    };
    await mkdir(join(output, '.agents', 'plugins'), { recursive: true });
    await json(join(output, '.agents', 'plugins', 'marketplace.json'), market);
    await copy(join(root, 'packaging', 'marketplace-readme.md'), join(output, 'README.md'));
    await copy(join(root, 'LICENSE'), join(output, 'LICENSE'));
    // Keep Git checkout bytes identical to the checksummed release, also on Windows.
    await writeFile(join(output, '.gitattributes'), '* -text\nplugins/session-tree/runtime/node.exe binary\n');
    await writeFile(join(plugin, 'THIRD_PARTY_NOTICES.md'), `# Third-party runtime\n\nThis package includes the unmodified official Node.js ${runtime.version} Windows x64 executable.\n\nSource: ${baseUrl + runtime.archive}\n\nOfficial checksums: ${baseUrl}SHASUMS256.txt\n\nThe complete upstream license, including notices for dependencies compiled into Node.js, is included in [runtime/LICENSE](runtime/LICENSE). The runtime license does not assign a license to SessionTree.\n\nThe plugin starts this executable directly; it does not install Node.js globally, use npm, or download code on first use.\n`);
    await json(join(output, 'release.json'), {
      format: 1, plugin: manifest.name, version: manifest.version, platform: 'windows-x64',
      marketplace: market.name, status: 'local-review-candidate',
      runtime: { ...runtime, url: baseUrl + runtime.archive, license: 'plugins/session-tree/runtime/LICENSE' },
      files: await fingerprints(output),
    });
    run('tar', ['-a', '-cf', archive, '-C', output, '.']);
    await writeFile(`${archive}.sha256`, `${await hash(archive)}  ${name}.zip\n`);
    console.log(JSON.stringify({ output, archive, runtime: version, files: Object.keys((await fingerprints(output))).length }, null, 2));
  } finally { await rm(contained(cache, scratch), { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
