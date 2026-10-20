import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { PLUGIN_FILES } from './plugin-files.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'codex-local-privacy-router-exec';
const executableFiles = new Set(['hooks/session-start.sh', 'hooks/user-prompt-submit.sh']);

function sourceFile(root, relative) {
  const parts = relative.split('/');
  if (path.isAbsolute(relative) || relative.includes('\\') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe package path: ${relative}`);
  }
  let filename = root;
  for (const [index, part] of parts.entries()) {
    filename = path.join(filename, part);
    let stat;
    try { stat = fs.lstatSync(filename); }
    catch (error) { throw new Error(`Required package file ${relative}: ${error.code}`); }
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in package paths: ${relative}`);
    if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`Required package path has an invalid file type: ${relative}`);
    }
  }
  const resolved = fs.realpathSync(filename);
  if (!resolved.startsWith(root + path.sep)) throw new Error(`Package path escapes the source directory: ${relative}`);
  return resolved;
}

function validateVersion(version) {
  const match = typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`package.json.version must be a valid SemVer version; received ${JSON.stringify(version)}`);
  }
}

function checkOutput(filename, directory = false) {
  let stat;
  try { stat = fs.lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Refusing to overwrite a symbolic link or unexpected file type: ${filename}`);
  }
}

export function packagePlugin({ root = projectRoot, tag } = {}) {
  const source = path.resolve(root);
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw new Error('The package source must be a directory, not a symbolic link.');
  root = fs.realpathSync(source);
  const packageInfo = JSON.parse(fs.readFileSync(sourceFile(root, 'package.json'), 'utf8'));
  if (packageInfo.name !== pluginName) throw new Error(`package.json.name must be ${pluginName}`);
  validateVersion(packageInfo.version);
  const version = packageInfo.version;
  if (tag !== undefined && tag !== `exec-v${version}`) throw new Error(`Release tag must be exec-v${version}; received ${JSON.stringify(tag)}`);

  const entries = Object.create(null);
  for (const relative of PLUGIN_FILES) {
    entries[relative] = [fs.readFileSync(sourceFile(root, relative)), {
      // ZIP stores local calendar fields. Construct the fixed local date so
      // the archive bytes stay identical across source mtimes and time zones.
      mtime: new Date(2000, 0, 1, 0, 0, 0),
      os: 3,
      attrs: ((executableFiles.has(relative) ? 0o100755 : 0o100644) << 16) >>> 0,
    }];
  }
  const archive = zipSync(entries, { level: 9 });
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  const output = path.join(root, 'dist');
  const zipName = `${pluginName}-${version}.zip`;
  const zipPath = path.join(output, zipName);
  const checksumPath = `${zipPath}.sha256`;
  checkOutput(output, true);
  checkOutput(zipPath);
  checkOutput(checksumPath);
  fs.mkdirSync(output, { recursive: true });
  const staging = fs.mkdtempSync(path.join(output, '.package-'));
  try {
    const stagedZip = path.join(staging, zipName);
    const stagedChecksum = `${stagedZip}.sha256`;
    fs.writeFileSync(stagedZip, archive, { mode: 0o644 });
    fs.writeFileSync(stagedChecksum, `${sha256}  ${zipName}\n`, { mode: 0o644 });
    fs.renameSync(stagedZip, zipPath);
    fs.renameSync(stagedChecksum, checksumPath);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  return { version, zipPath, checksumPath, sha256 };
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/package-plugin.mjs [--tag exec-vVERSION]\nCreates the installation ZIP and SHA-256 file in dist/.');
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--tag' && args[1])) {
    throw new Error('Usage: node scripts/package-plugin.mjs [--tag exec-vVERSION]');
  }
  const result = packagePlugin({ tag: args[1] });
  console.log(`Created ${result.zipPath}\nCreated ${result.checksumPath}\nSHA-256: ${result.sha256}`);
}

if (process.argv[1] && fs.existsSync(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Plugin packaging failed: ${error.message}`); process.exitCode = 1; }
}
