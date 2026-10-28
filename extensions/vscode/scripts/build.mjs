import assert from 'node:assert/strict';
import { mkdir, copyFile, readFile, chmod } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const root = resolve(extension, '../..');
export const platforms = [
  { id: 'win32-x64', artifact: 'windows-x64', binary: 'session-tree.exe' },
  { id: 'darwin-arm64', artifact: 'macos-arm64', binary: 'session-tree' },
  { id: 'darwin-x64', artifact: 'macos-x64', binary: 'session-tree' },
];

export function run(command, args, cwd = extension) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, command + ' failed');
}

export async function prepareBinary(platform, destination = extension) {
  const { createHash, randomUUID } = await import('node:crypto');
  const { zipEntries } = await import('../../../scripts/lib/archive.mjs');
  const directory = join(root, 'dist/session-tree-0.7.1-preview-3edd5fd', platform.artifact);
  const prefix = 'session-tree-0.7.1-' + platform.artifact;
  const archive = join(directory, prefix + '-plugin.zip');
  let source;
  try {
    const report = JSON.parse(await readFile(join(directory, prefix + '.verification.json'), 'utf8'));
    const bytes = await readFile(archive);
    assert.equal(report.passed, true);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.archiveSha256);
    assert.equal((await zipEntries(archive)).find(entry => entry.name === 'bin/' + platform.binary).mode & 0o111, 0o111);
    const unpack = join(root, '.session-tree/vscode-build', platform.id + '-' + randomUUID().slice(0, 8));
    await mkdir(unpack, { recursive: true });
    run('tar', ['-xf', archive, '-C', unpack]);
    source = join(unpack, 'bin', platform.binary);
    await copyFile(join(unpack, 'THIRD_PARTY_NOTICES.txt'), join(destination, 'THIRD_PARTY_NOTICES.txt'));
  } catch (error) {
    if (error.code !== 'ENOENT' || platform.id !== process.platform + '-' + process.arch) throw error;
    source = join(root, 'plugins/session-tree/bin', platform.binary);
  }
  if (platform.id === process.platform + '-' + process.arch) source = join(root, 'target/release', platform.binary);
  await mkdir(join(destination, 'bin'), { recursive: true });
  await copyFile(source, join(destination, 'bin', platform.binary));
  await chmod(join(destination, 'bin', platform.binary), 0o755);
}

export async function build() {
  run('cargo', ['build', '--release', '--locked', '-p', 'session-tree'], root);
  run(process.execPath, [join(extension, 'node_modules/typescript/bin/tsc'), '--project', extension]);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', root, '--noEmit']);
  run(process.execPath, [join(extension, 'scripts/build-webview.mjs')]);
  await mkdir(join(extension, 'assets'), { recursive: true });
  await copyFile(join(root, 'plugins/session-tree/assets/session-tree.png'), join(extension, 'assets/session-tree.png'));
  await copyFile(join(root, 'LICENSE'), join(extension, 'LICENSE'));
  const platform = platforms.find(target => target.id === process.platform + '-' + process.arch);
  assert.ok(platform, 'This preview packages Windows x64 and both Mac architectures.');
  await prepareBinary(platform);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
