import { copyFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('cargo', ['build', '--release', '--locked', '-p', 'session-tree'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Rust build failed');
const name = 'session-tree' + (process.platform === 'win32' ? '.exe' : '');
await mkdir(join(root, 'plugins/session-tree/bin'), { recursive: true });
await copyFile(join(root, 'target/release', name), join(root, 'plugins/session-tree/bin', name));
