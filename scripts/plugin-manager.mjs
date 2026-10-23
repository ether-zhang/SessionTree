import { cp, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../plugins/session-tree/src/core/store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pluginId = 'session-tree@session-tree-local', marketName = 'session-tree-local';
const data = join(root, '.session-tree'), backups = join(data, 'backups');
const marketPath = join(root, '.agents', 'plugins', 'marketplace.json');
const latestPath = join(data, 'last-install.json');

function contained(parent, target) {
  const path = relative(resolve(parent), resolve(target));
  if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error(`Path is outside the expected directory: ${target}`);
  return resolve(target);
}
function codex(args, { json = true } = {}) {
  const result = spawnSync('codex', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Codex command failed: ${args.join(' ')}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function installed() {
  return codex(['plugin', 'list', '--json']).installed.find(plugin => plugin.pluginId === pluginId) || null;
}
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function fingerprint(directory) {
  const hashes = {};
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Plugin backups must not contain symbolic links.');
      if (entry.isDirectory()) await visit(child);
      else hashes[relative(directory, child).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(child)).digest('hex');
    }
  }
  await visit(directory);
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}
async function setMarketplace(packageRoot, base) {
  const path = './' + relative(root, contained(root, packageRoot)).replaceAll('\\', '/');
  const manifest = structuredClone(base);
  if (manifest.name !== marketName) throw new Error('An unrelated marketplace exists; no changes were made.');
  const plugin = manifest.plugins.find(entry => entry.name === 'session-tree');
  if (!plugin) throw new Error('SessionTree is missing from the marketplace manifest.');
  plugin.source = { source: 'local', path };
  await writeJson(marketPath, manifest);
}
async function registerAndInstall(expectedVersion) {
  codex(['plugin', 'marketplace', 'add', root, '--json']);
  // Existing conversations keep their MCP connection until the host reloads it.
  // Modern packages use PLUGIN_DATA as cwd, so installation need not stop them.
  codex(['plugin', 'add', pluginId, '--json']);
  const current = installed();
  if (!current?.enabled || current.version !== expectedVersion) throw new Error('Installed plugin version did not match the requested version.');
  return current;
}

async function rollback(snapshotPath) {
  const path = contained(backups, snapshotPath);
  const state = JSON.parse(await readFile(join(path, 'state.json'), 'utf8'));
  if (state.version !== 1 || state.pluginId !== pluginId) throw new Error('Unsupported rollback snapshot.');
  if (state.previous) {
    const packageRoot = contained(path, join(path, 'plugin'));
    if (JSON.stringify(await fingerprint(packageRoot)) !== JSON.stringify(state.hashes)) throw new Error('Backup files changed; rollback was stopped before installation.');
    const manifest = JSON.parse(await readFile(join(packageRoot, 'plugin.json'), 'utf8'));
    if (manifest.name !== 'session-tree' || manifest.version !== state.previous.version) throw new Error('Backup identity mismatch.');
    await setMarketplace(packageRoot, await optionalJson(marketPath) || state.marketplace);
    const restored = await registerAndInstall(state.previous.version);
    console.log(JSON.stringify({ action: 'rollback', version: restored.version, enabled: restored.enabled, snapshotPath: path }));
  } else {
    codex(['plugin', 'remove', pluginId], { json: false });
    if (state.originalMarketplace) await writeJson(marketPath, state.originalMarketplace);
    else await rm(contained(root, marketPath), { force: true });
    console.log(JSON.stringify({ action: 'rollback', installed: false, snapshotPath: path }));
  }
}

async function install() {
  const previous = installed();
  if (previous && !previous.enabled) throw new Error('The existing plugin is disabled; installation stopped to preserve that preference.');
  const originalMarketplace = await optionalJson(marketPath);
  const marketplace = originalMarketplace || JSON.parse(await readFile(join(root, 'marketplace.json'), 'utf8'));
  if (marketplace.name !== marketName) throw new Error('An unrelated marketplace exists; no changes were made.');
  const snapshotPath = contained(backups, join(backups, `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
  await mkdir(snapshotPath, { recursive: true });
  let hashes = {};
  if (previous) {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
    const source = await realpath(join(codexHome, 'plugins', 'cache', marketName, 'session-tree', previous.version));
    const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
    if (manifest.name !== 'session-tree' || manifest.version !== previous.version) throw new Error('Installed package identity mismatch; installation stopped.');
    await cp(source, join(snapshotPath, 'plugin'), { recursive: true, errorOnExist: true, force: false });
    hashes = await fingerprint(join(snapshotPath, 'plugin'));
  }
  await writeJson(join(snapshotPath, 'state.json'), { version: 1, pluginId, previous: previous ? { version: previous.version, enabled: previous.enabled } : null,
    originalMarketplace, marketplace, hashes });
  await writeJson(latestPath, { snapshotPath });
  try {
    await setMarketplace(join(root, 'plugins', 'session-tree'), marketplace);
    const desired = JSON.parse(await readFile(join(root, 'plugins', 'session-tree', 'plugin.json'), 'utf8'));
    const current = await registerAndInstall(desired.version);
    console.log(JSON.stringify({ action: 'install', version: current.version, enabled: current.enabled, snapshotPath,
      rollback: 'node scripts/plugin-manager.mjs rollback' }));
  } catch (error) {
    console.error(`Installation failed: ${error.message}. Restoring the previous plugin.`);
    await rollback(snapshotPath);
    throw error;
  }
}

const command = process.argv[2];
try {
  if (command === 'install') await install();
  else if (command === 'rollback') {
    const latest = process.argv[3] ? { snapshotPath: process.argv[3] } : await optionalJson(latestPath);
    if (!latest?.snapshotPath) throw new Error('No saved installation snapshot exists.');
    await rollback(latest.snapshotPath);
  } else throw new Error('Usage: node scripts/plugin-manager.mjs install|rollback [snapshot-path]');
} catch (error) { console.error(error.message); process.exitCode = 1; }
