import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const testRoot = fileURLToPath(new URL('../.session-tree/tests/', import.meta.url));

export const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
export async function fixture(t) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'session-tree-test-'));
  t.after(async () => {
    const target = resolve(directory);
    if (!target.startsWith(resolve(testRoot) + sep) || !basename(target).startsWith('session-tree-test-')) throw new Error('Unsafe test cleanup path.');
    await rm(target, { recursive: true, force: true });
  });
  const home = join(directory, 'codex'), dataDir = join(directory, 'data');
  await mkdir(home);
  return { directory, home, dataDir };
}

export function meta(id, extra = {}) {
  return { type: 'session_meta', payload: { id, timestamp: '2026-10-14T10:00:00Z', cwd: 'D:\\Project\\demo', source: 'vscode', ...extra } };
}
export async function rollout(home, id, extra = {}, { archived = false, suffix = '', content } = {}) {
  const directory = join(home, archived ? 'archived_sessions' : 'sessions', '2026', '10', '14');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-2026-10-14T10-00-00-${id}.jsonl${suffix}`);
  await writeFile(path, content ?? `${JSON.stringify(meta(id, extra))}\n`);
  return path;
}
