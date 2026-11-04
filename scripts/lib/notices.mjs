import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Collect notices from the locked Rust sources present on the native build host. */
export async function nativeNotices(root, frontendNotices = 'assets/frontend-licenses.txt') {
  const result = spawnSync('cargo', ['metadata', '--format-version=1', '--locked'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(result.stdout);
  const sections = ['# Third-party components\n\nSessionTree links SQLite and Zstandard into its Rust executable. SQLite is in the public domain: https://sqlite.org/copyright.html. Other linked crate notices follow. Frontend notices are in ' + frontendNotices + '.'];
  for (const pkg of metadata.packages.filter(pkg => !metadata.workspace_members.includes(pkg.id)).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = dirname(pkg.manifest_path);
    const files = (await readdir(directory)).filter(file => /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[._-]|$)/i.test(file));
    if (pkg.name === 'zstd-sys') {
      try { if ((await lstat(join(directory, 'zstd/LICENSE'))).isFile()) files.push('zstd/LICENSE'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const contents = [];
    for (const file of files) if ((await lstat(join(directory, file))).isFile()) contents.push(file + '\n\n' + await readFile(join(directory, file), 'utf8'));
    sections.push('## ' + pkg.name + ' ' + pkg.version + '\n\nLicense: ' + pkg.license + '\n' +
      (pkg.repository || 'https://crates.io/crates/' + pkg.name) + '\n\n' + contents.join('\n\n'));
  }
  return sections.join('\n\n---\n\n') + '\n';
}
