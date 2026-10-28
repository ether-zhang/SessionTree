import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { build, extension, root, platforms, prepareBinary, run } from './build.mjs';
import { zipEntries } from '../../../scripts/lib/archive.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

await build();
const manifest = JSON.parse(await readFile(join(extension, 'package.json'), 'utf8'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
assert.match(revision, /^[0-9a-f]{40,64}$/);
const vscePackage = JSON.parse(await readFile(join(extension, 'node_modules/@vscode/vsce/package.json'), 'utf8'));
const vsce = join(extension, 'node_modules/@vscode/vsce', typeof vscePackage.bin === 'string' ? vscePackage.bin : vscePackage.bin.vsce);
const output = join(root, 'dist/vscode');
await mkdir(output, { recursive: true });
for (const platform of platforms.filter(target => target.id === process.platform + '-' + process.arch)) {
  const stage = join(root, '.session-tree/vscode-package', platform.id + '-' + randomUUID().slice(0, 8));
  await mkdir(stage, { recursive: true });
  for (const file of ['out', 'assets', 'l10n', 'media', 'images']) await cp(join(extension, file), join(stage, file), { recursive: true });
  for (const file of ['README.md', 'DEVELOPMENT.md', 'LICENSE', 'package.nls.json', 'package.nls.zh-cn.json', 'package.nls.zh-tw.json']) {
    await copyFile(join(extension, file), join(stage, file));
  }
  const packaged = { ...manifest };
  delete packaged.scripts; delete packaged.devDependencies;
  packaged.files = ['out/**', 'assets/**', 'bin/**', 'l10n/**', 'media/**', 'images/**', 'package.nls*.json', 'README.md', 'DEVELOPMENT.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
  await writeFile(join(stage, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
  await prepareBinary(platform, stage);
  const archive = join(output, `session-tree-${manifest.version}-${platform.id}.vsix`);
  // vsce does not infer repository.directory when resolving Markdown links.
  const repository = manifest.repository.url.replace(/\.git$/, '');
  run(process.execPath, [vsce, 'package', '--no-dependencies', '--target', platform.id, '--out', archive,
    '--baseContentUrl', `${repository}/blob/${revision}/${manifest.repository.directory}`,
    '--baseImagesUrl', `${repository}/raw/${revision}/${manifest.repository.directory}`], stage);
  // A Windows packaging host has no Unix execute bits. Preserve them in the VSIX central directory.
  const bytes = await readFile(archive);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'VSIX directory missing');
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name === 'extension/bin/' + platform.binary) {
      bytes.writeUInt16LE((3 << 8) | (bytes.readUInt16LE(cursor + 4) & 255), cursor + 4);
      bytes.writeUInt32LE((0o100755 * 65536) >>> 0, cursor + 38);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  await writeFile(archive, bytes);
  const entries = await zipEntries(archive);
  assert.ok(entries.some(entry => /^extension\/LICENSE(?:\.txt)?$/i.test(entry.name)), 'VSIX must retain the MIT license');
  assert.equal(entries.find(entry => entry.name === 'extension/bin/' + platform.binary).mode & 0o111, 0o111);
  assert.ok(!entries.some(entry => /(?:^|\/)(?:node_modules|src|test|runtime)(?:\/|$)/.test(entry.name)));
  assert.equal(entries.filter(entry => entry.name.startsWith('extension/bin/')).length, 1);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(archive + '.sha256', sha256 + '  ' + archive.split(/[\\/]/).pop() + '\n');
  console.log(JSON.stringify({ platform: platform.id, archive, bytes: bytes.length, sha256 }));
}
