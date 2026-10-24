import assert from 'node:assert/strict';
import { zipDirectory } from './lib/archive.mjs';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(join(root, 'plugins/session-tree/plugin.json'), 'utf8'));
const marketplace = join(root, 'dist', 'session-tree-' + source.version + '-universal');
const output = marketplace + '-submission-draft';
const archive = output + '.zip';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
function inside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  assert.ok(child && child !== '..' && !child.startsWith('..\\') && !child.startsWith('../') && !isAbsolute(child), 'Unsafe archive path');
  return target;
}
function run(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}
async function inventory(directory) {
  const result = {};
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else {
        assert.ok(entry.isFile(), 'Symlinks are not allowed in submission packages');
        result[relative(directory, child).replaceAll('\\', '/')] = hash(await readFile(child));
      }
    }
  }
  await visit(directory);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
async function main() {
  assert.equal(process.argv.length, 2, 'Usage: node scripts/build-submission.mjs');
  const verified = await json(marketplace + '.verification.json');
  assert.equal(verified.passed, true);
  assert.equal(verified.archiveSha256, hash(await readFile(marketplace + '-plugin.zip')), 'Verify the current universal archive first');
  await mkdir(output); // Never overwrite an earlier submission draft.
  await cp(join(marketplace, 'plugins/session-tree'), output, { recursive: true });
  const manifest = await json(join(output, 'plugin.json'));
  assert.deepEqual(manifest, source, 'Rebuild the marketplace after editing source metadata');
  const extension = manifest.extensions['com.openai'];
  // Public submission uses the existing transparent PNG for both listing assets.
  extension.interface.composerIcon = extension.interface.logo;
  for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    const url = new URL(extension.interface[field]);
    assert.equal(url.protocol, 'https:');
    assert.ok(!url.username && !url.password);
  }
  for (const [field, limit] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000]]) {
    const value = extension.interface[field];
    assert.ok(typeof value === 'string' && value.trim() && [...value].length <= limit, field);
  }
  assert.equal(extension.interface.category, 'Productivity');
  const cases = extension.review.test_cases;
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
  for (const item of [...cases.positive, ...cases.negative]) {
    assert.ok(item.description?.trim() && item.prompt?.trim());
  }
  for (const item of cases.positive) assert.ok(item.tools_triggered?.trim() && item.expected_behavior?.trim());
  assert.equal(extension.review.commerce, false);
  assert.deepEqual(extension.publication.countries, []);
  const mcp = await json(join(output, 'mcp.json'));
  assert.equal(mcp.mcpServers['session-tree'].type, 'stdio');
  assert.equal(mcp.mcpServers['session-tree'].command, './runtime/node');
  for (const field of ['logo', 'composerIcon']) {
    const bytes = await readFile(inside(output, join(output, extension.interface[field])));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length <= 5 * 1024 * 1024);
    assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    assert.ok(bytes.readUInt32BE(16) >= (field === 'logo' ? 256 : 48));
  }
  await writeFile(join(output, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = await inventory(output);
  assert.ok(!Object.keys(files).some(path => /(^|\/)(\.app\.json|\.agents|skills|auth\.json|\.session-tree|client-integration)(\/|$)/.test(path)));
  assert.ok(!manifest.apps && !extension.apps);
  await zipDirectory(output, archive, { executablePaths: ['runtime/node', 'runtime/node.exe'] });
  const workRoot = join(root, '.session-tree', 'submission-verification');
  await mkdir(workRoot, { recursive: true });
  const extracted = await mkdtemp(join(workRoot, 'archive-'));
  try {
    run(['-xf', archive, '-C', extracted]);
    assert.deepEqual(await inventory(extracted), files, 'Submission ZIP differs from its prepared files');
  } finally { await rm(inside(workRoot, extracted), { recursive: true, force: true }); }
  const archiveSha256 = hash(await readFile(archive));
  await writeFile(archive + '.sha256', archiveSha256 + '  ' + archive.split(/[\\/]/).at(-1) + '\n');
  const report = { version: manifest.version, archiveValid: true, submissionReady: false, archiveSha256,
    files, listingUrlsNeedPublishedContentVerification: true,
    remaining: ['Confirm approved-partner access for local MCP submission', 'Verify the individual OpenAI developer identity',
      'Supply and verify the actual native-workflow recording', 'Complete portal scans, attestations and review'],
  };
  await writeFile(output + '.verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ archive, archiveSha256, fileCount: Object.keys(files).length,
    archiveValid: true, submissionReady: false, remaining: report.remaining }, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
