import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const backend = fileURLToPath(new URL('../target/release/session-tree' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
const result = spawnSync(process.execPath, ['--test', '--test-timeout=10000', 'test/integration.test.mjs', 'test/native.test.mjs'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, SESSION_TREE_TEST_BACKEND: backend },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
