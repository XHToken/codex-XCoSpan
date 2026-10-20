import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { PLUGIN_FILES } from './plugin-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const maxBytes = 64 * 1024 * 1024;

// fflate handles decompression and entry names, but does not expose Unix file
// types. Inspect only ordinary, single-disk ZIP metadata emitted by our builder.
function inspectArchive(bytes) {
  const end = bytes.length - 22;
  assert.ok(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, 'Expected a ZIP without an archive comment');
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'Archive comments are not part of the package format');
  assert.equal(bytes.readUInt32LE(end + 4), 0, 'Multi-disk ZIPs are not supported');
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count, 'ZIP entry counts disagree');
  assert.equal(count, PLUGIN_FILES.length, 'ZIP entry count does not match the release allowlist');
  const directory = bytes.readUInt32LE(end + 16);
  assert.equal(directory + bytes.readUInt32LE(end + 12), end, 'Invalid ZIP central directory');
  let cursor = directory;
  for (let index = 0; index < count; index += 1) {
    assert.ok(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'Invalid ZIP entry header');
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    assert.ok(next <= end, 'ZIP entry extends beyond the central directory');
    const attrs = bytes.readUInt32LE(cursor + 38), type = (attrs >>> 16) & 0xf000;
    assert.notEqual(type, 0xa000, 'ZIP must not contain symbolic links');
    assert.ok((type === 0 || type === 0x8000) && !(attrs & 0x10), 'ZIP must contain only regular files');
    assert.equal(bytes.readUInt16LE(cursor + 34), 0, 'ZIP entries must be on the same disk');
    assert.ok(!(bytes.readUInt16LE(cursor + 8) & 1), 'Encrypted ZIP entries are unsupported');
    cursor = next;
  }
  assert.equal(cursor, end, 'Unexpected central-directory data');
}

function runNode(script, { cwd, input = '', args = [] } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, input, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024, shell: false,
  });
  if (result.error) throw new Error(`${path.basename(script)}: ${result.error.message}`);
  assert.equal(result.status, 0,
    `${path.basename(script)} failed (${result.signal || result.status}): ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function checkHooks(unpacked, cwd) {
  const marker = 'SYNTHETIC_PACKAGE_CHECK_DO_NOT_ECHO';
  const session = path.join(unpacked, 'hooks/session-start.mjs');
  const prompt = path.join(unpacked, 'hooks/prompt-routing.mjs');
  assert.match(runNode(session, { cwd, input: '{}' }), /run_cloud_analysis/);
  const output = runNode(prompt, { cwd, input: JSON.stringify({ prompt: marker }) });
  const hook = JSON.parse(output).hookSpecificOutput;
  assert.equal(hook?.hookEventName, 'UserPromptSubmit');
  assert.match(hook.additionalContext, /Preliminary local candidate scan:/);
  assert.ok(!output.includes(marker), 'Prompt Hook must not echo the submitted text');
  const subagentInput = JSON.stringify({ agent_id: 'package-check-subagent', prompt: marker });
  assert.match(runNode(session, { cwd, input: subagentInput }), /You are an analysis subagent/);
  const subagentHook = JSON.parse(runNode(prompt, { cwd, input: subagentInput })).hookSpecificOutput;
  assert.match(subagentHook?.additionalContext, /You are an analysis subagent/);
}

function main() {
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/check-package.mjs [archive.zip]');
  const archive = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, 'dist', `${packageInfo.name}-${packageInfo.version}.zip`);
  assert.ok(fs.statSync(archive).size <= maxBytes, 'ZIP exceeds the 64 MiB package-check limit');
  const bytes = fs.readFileSync(archive);
  const checksum = /^([a-f\d]{64})  ([^\r\n]+)\r?\n?$/i.exec(fs.readFileSync(`${archive}.sha256`, 'utf8'));
  assert.ok(checksum, 'Invalid .zip.sha256 sidecar');
  assert.equal(checksum[2], path.basename(archive), 'Checksum filename does not match the ZIP');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), checksum[1].toLowerCase(), 'ZIP SHA-256 mismatch');
  inspectArchive(bytes);
  const allowed = new Set(PLUGIN_FILES), entries = new Map();
  let totalSize = 0;
  const files = unzipSync(bytes, { filter({ name, originalSize }) {
    assert.ok(name && !name.includes('\\') && !name.includes('\0')
      && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name)
      && !/^[a-z]:/i.test(name) && name.split('/').every((part) => part && part !== '.' && part !== '..'),
    `Unsafe ZIP path: ${JSON.stringify(name)}`);
    assert.ok(allowed.has(name), `Unexpected release file: ${name}`);
    assert.ok(!entries.has(name), `Duplicate ZIP entry: ${name}`);
    totalSize += originalSize;
    assert.ok(totalSize <= maxBytes, 'Unpacked release exceeds the 64 MiB package-check limit');
    entries.set(name, originalSize);
    return true;
  } });
  assert.deepEqual(Object.keys(files).sort(), [...PLUGIN_FILES].sort(), 'Decoded ZIP files differ from the allowlist');
  for (const [name, size] of entries) assert.equal(files[name].length, size, `Unpacked file size mismatch: ${name}`);
  for (const filename of ['package.json', 'plugin.json', '.codex-plugin/plugin.json']) {
    const manifest = JSON.parse(new TextDecoder().decode(files[filename]));
    assert.equal(manifest.name, packageInfo.name, `${filename}: unexpected packaged name`);
    assert.equal(manifest.version, packageInfo.version, `${filename}: unexpected packaged version`);
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-package-check-'));
  try {
    const unpacked = path.join(temporary, '插件 发布包');
    const cwd = path.join(temporary, '无关 工作目录');
    fs.mkdirSync(cwd, { recursive: true });
    for (const [filename, content] of Object.entries(files)) {
      const destination = path.resolve(unpacked, filename);
      assert.ok(destination.startsWith(unpacked + path.sep), `ZIP path escapes extraction directory: ${filename}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, { flag: 'wx' });
    }
    // The release excludes development scripts. Copy only the check harnesses;
    // their root-relative reads and server launch now target the unpacked ZIP.
    fs.mkdirSync(path.join(unpacked, 'scripts'));
    for (const script of ['check-manifests.mjs', 'smoke-mcp.mjs']) {
      const destination = path.join(unpacked, 'scripts', script);
      fs.copyFileSync(path.join(root, 'scripts', script), destination);
      console.log(runNode(destination, { cwd }).trim());
    }
    checkHooks(unpacked, cwd);
    assert.match(runNode(path.join(unpacked, 'install.mjs'), { cwd, args: ['--help'] }), /Usage: node install\.mjs/);
    console.log(`Package check passed: ${path.basename(archive)}, ${entries.size} allowlisted files, checksum, manifests, MCP, Hooks and installer help verified from the extracted ZIP.`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) { console.error(`Package check failed: ${error.message}`); process.exitCode = 1; }
