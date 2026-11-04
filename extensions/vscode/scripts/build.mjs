import assert from 'node:assert/strict';
import { mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nativeNotices } from '../../../scripts/lib/notices.mjs';

export const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const root = resolve(extension, '../..');
export const platforms = [
  { id: 'win32-x64', binary: 'session-tree.exe' },
  { id: 'darwin-arm64', binary: 'session-tree' },
];

export function run(command, args, cwd = extension) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, command + ' failed');
}

export async function prepareBinary(platform, destination = extension) {
  assert.equal(platform.id, process.platform + '-' + process.arch, 'Build each package on its native platform.');
  const source = join(root, 'target/release', platform.binary);
  await mkdir(join(destination, 'bin'), { recursive: true });
  await copyFile(source, join(destination, 'bin', platform.binary));
  await chmod(join(destination, 'bin', platform.binary), 0o755);
}

export async function build() {
  const platform = platforms.find(target => target.id === process.platform + '-' + process.arch);
  assert.ok(platform, 'This preview packages Windows x64 and Apple Silicon Mac.');
  run('cargo', ['build', '--release', '--locked', '-p', 'session-tree'], root);
  run(process.execPath, [join(extension, 'node_modules/typescript/bin/tsc'), '--project', extension]);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', root, '--noEmit']);
  run(process.execPath, [join(extension, 'scripts/build-webview.mjs')]);
  await mkdir(join(extension, 'assets'), { recursive: true });
  await copyFile(join(root, 'plugins/session-tree/assets/session-tree.png'), join(extension, 'assets/session-tree.png'));
  await copyFile(join(root, 'LICENSE'), join(extension, 'LICENSE'));
  await writeFile(join(extension, 'THIRD_PARTY_NOTICES.txt'), await nativeNotices(root, 'media/frontend-licenses.txt'));
  await prepareBinary(platform);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
