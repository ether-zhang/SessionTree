import { createWriteStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import assert from 'node:assert/strict';
import yazl from 'yazl';

export async function zipDirectory(directory, target, { executablePaths = [] } = {}) {
  assert.ok(relative(resolve(directory), resolve(target)).startsWith('..'), 'ZIP must be outside its input directory');
  const zip = new yazl.ZipFile(), executable = new Set(executablePaths);
  const finished = pipeline(zip.outputStream, createWriteStream(target, { flags: 'wx' }));
  zip.on('error', error => zip.outputStream.destroy(error));
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else {
        assert.ok(entry.isFile(), 'Archive inputs must not contain symlinks');
        const name = relative(directory, file).replaceAll('\\', '/');
        zip.addFile(file, name, {
          mode: executable.has(name) ? 0o100755 : 0o100644,
          mtime: new Date('2026-01-01T00:00:00Z'),
          compressionLevel: /\.(?:xz|zip)$/.test(name) ? 0 : 9,
        });
      }
    }
  }
  await visit(resolve(directory));
  zip.end();
  await finished;
}

/** Inspect the central directory without extracting or executing package contents. */
export async function zipEntries(file) {
  const bytes = await readFile(file);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, 'ZIP directory missing');
  const count = bytes.readUInt16LE(end + 10), entries = [];
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.ok(name && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'Unsafe ZIP entry');
    entries.push({ name, mode: bytes.readUInt32LE(cursor + 38) >>> 16,
      size: bytes.readUInt32LE(cursor + 24), compressedSize: bytes.readUInt32LE(cursor + 20) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
