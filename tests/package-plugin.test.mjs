import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { packagePlugin } from '../scripts/package-plugin.mjs';
import { PLUGIN_FILES } from '../scripts/plugin-files.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of PLUGIN_FILES) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `Synthetic release fixture: ${relative}\n`);
  }
  const metadata = { name: 'codex-local-privacy-router', version: '1.2.3', type: 'module', devDependencies: { 'fixture-development-dependency': '1.0.0' } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  return root;
}

function updateVersion(root, version) {
  const filename = path.join(root, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
  metadata.version = version;
  fs.writeFileSync(filename, JSON.stringify(metadata, null, 2) + '\n');
}

test('installation ZIP contains only allowed runtime files and offline documentation at its root', (t) => {
  const root = fixture(t);
  const excluded = ['.env', '.git/config', '.github/workflows/ci.yml', 'node_modules/private.txt', 'tests/private.test.mjs', 'scripts/local-task.mjs', 'ui/src/review.js', 'ui/review.template.html', 'config/local.json', 'docs/private-notes.md', 'mcp/temporary.mjs'];
  for (const relative of excluded) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'EXCLUDED_LOCAL_MATERIAL');
  }
  const result = packagePlugin({ root, tag: 'v1.2.3' });
  const archive = fs.readFileSync(result.zipPath);
  const files = unzipSync(archive);
  assert.equal(path.basename(result.zipPath), 'codex-local-privacy-router-1.2.3.zip');
  assert.deepEqual(Object.keys(files), [...PLUGIN_FILES]);
  for (const required of ['plugin.json', '.codex-plugin/plugin.json', '.mcp.json', 'hooks.json', 'mcp/server.mjs', 'shared/messages.mjs', 'ui/contract-redaction-review.html', 'install.mjs', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'docs/installation.md', 'docs/usage.md', 'config/detection.example.json', 'skills/privacy-routing/SKILL.md', 'skills/privacy-routing/references/routing-policy.md']) {
    assert.ok(files[required], `Missing installation or offline documentation file: ${required}`);
    assert.deepEqual(Buffer.from(files[required]), fs.readFileSync(path.join(root, required)));
  }
  for (const relative of excluded) assert.equal(files[relative], undefined, `Unexpected local file: ${relative}`);
  assert.deepEqual(Buffer.from(files['package.json']), fs.readFileSync(path.join(root, 'package.json')), 'Package metadata, including development dependencies, must be preserved');
  assert.equal(result.sha256, crypto.createHash('sha256').update(archive).digest('hex'));
  assert.equal(fs.readFileSync(result.checksumPath, 'utf8'), `${result.sha256}  ${path.basename(result.zipPath)}\n`);
});

test('rebuilding is reproducible across source metadata and time zones and preserves other artifacts', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'dist'));
  const otherArtifact = path.join(root, 'dist', 'codex-local-privacy-router-0.9.0.zip');
  fs.writeFileSync(otherArtifact, 'keep this release');
  const first = packagePlugin({ root });
  const bytes = fs.readFileSync(first.zipPath);
  for (const relative of PLUGIN_FILES) {
    const filename = path.join(root, relative);
    fs.utimesSync(filename, new Date('2025-06-12T01:02:03Z'), new Date('2025-06-12T01:02:03Z'));
    fs.chmodSync(filename, 0o600);
  }
  const moduleUrl = new URL('../scripts/package-plugin.mjs', import.meta.url).href;
  const script = `import { packagePlugin } from ${JSON.stringify(moduleUrl)}; packagePlugin({ root: ${JSON.stringify(root)} });`;
  for (const timezone of ['UTC', 'Asia/Shanghai']) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    assert.deepEqual(fs.readFileSync(first.zipPath), bytes, `Archive changed in ${timezone}`);
  }
  assert.equal(fs.readFileSync(otherArtifact, 'utf8'), 'keep this release');
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist')).sort(), [path.basename(otherArtifact), path.basename(first.zipPath), path.basename(first.checksumPath)].sort());
});

test('packaging rejects invalid versions and mismatched release tags before creating output', (t) => {
  const root = fixture(t);
  for (const version of ['../outside', '1.2', '01.2.3', '1.2.3-01', '1.2.3/', '', 123]) {
    updateVersion(root, version);
    assert.throws(() => packagePlugin({ root }), /valid SemVer/, String(version));
    assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  }
  updateVersion(root, '1.2.3-beta.1+build.7');
  for (const tag of ['v1.2.3', '1.2.3-beta.1+build.7', '']) {
    assert.throws(() => packagePlugin({ root, tag }), /Release tag must be v1\.2\.3-beta\.1\+build\.7/);
    assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  }
  const valid = packagePlugin({ root, tag: 'v1.2.3-beta.1+build.7' });
  assert.equal(path.basename(valid.zipPath), 'codex-local-privacy-router-1.2.3-beta.1+build.7.zip');
});

test('missing required runtime files prevent an incomplete release', (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'shared/messages.mjs'));
  assert.throws(() => packagePlugin({ root }), /Required package file shared\/messages\.mjs: ENOENT/);
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
});

test('symlinks in packaged files, parent directories, and output destinations are rejected', { skip: process.platform === 'win32' && 'Creating symbolic links may require elevated Windows privileges' }, (t) => {
  const root = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-package-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const originalMessage = path.join(root, 'shared/messages.mjs');
  const externalMessage = path.join(outside, 'messages.mjs');
  fs.writeFileSync(externalMessage, 'MUST_NOT_BE_PACKAGED_OR_OVERWRITTEN');
  fs.unlinkSync(originalMessage);
  fs.symlinkSync(externalMessage, originalMessage);
  assert.throws(() => packagePlugin({ root }), /Symbolic links are not allowed/);
  fs.rmSync(path.join(root, 'shared'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'shared'), 'dir');
  assert.throws(() => packagePlugin({ root }), /Symbolic links are not allowed/);
  fs.unlinkSync(path.join(root, 'shared'));
  fs.mkdirSync(path.join(root, 'shared'));
  fs.writeFileSync(originalMessage, 'Synthetic runtime module');
  fs.symlinkSync(outside, path.join(root, 'dist'), 'dir');
  assert.throws(() => packagePlugin({ root }), /Refusing to overwrite a symbolic link/);
  fs.unlinkSync(path.join(root, 'dist'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.symlinkSync(externalMessage, path.join(root, 'dist', 'codex-local-privacy-router-1.2.3.zip'));
  assert.throws(() => packagePlugin({ root }), /Refusing to overwrite a symbolic link/);
  assert.equal(fs.readFileSync(externalMessage, 'utf8'), 'MUST_NOT_BE_PACKAGED_OR_OVERWRITTEN');
  assert.deepEqual(fs.readdirSync(outside), ['messages.mjs']);
});
