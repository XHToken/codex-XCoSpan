import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { prepareMarketplace, resolveCodex, runCodex } from '../install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('installer entry runs from extracted Unicode, space and symlink paths', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-entry-'));
  try {
    const extracted = path.join(temporary, '安装目录 with spaces');
    fs.mkdirSync(extracted);
    fs.copyFileSync(path.join(root, 'install.mjs'), path.join(extracted, 'install.mjs'));
    const paths = [extracted];
    if (process.platform !== 'win32') {
      const link = path.join(temporary, 'link with spaces');
      fs.symlinkSync(extracted, link, 'dir');
      paths.push(link);
    }
    for (const directory of paths) {
      const result = spawnSync(process.execPath, [path.join(directory, 'install.mjs'), '--help'], { cwd: os.tmpdir(), encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Supports Windows, macOS and Linux/);
      assert.equal(fs.existsSync(path.join(directory, '.agents')), false);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('configured hooks launch from a different directory with spaces and Unicode in the plugin path', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-platform-'));
  try {
    const plugin = path.join(temporary, '插件 with spaces');
    for (const directory of ['hooks', 'mcp']) fs.cpSync(path.join(root, directory), path.join(plugin, directory), { recursive: true });
    const config = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const hook = config.hooks[event][0].hooks[0];
      assert.ok(hook.command.startsWith('node '));
      const command = hook.command.replaceAll('${PLUGIN_ROOT}', () => plugin);
      const result = spawnSync(command, {
        cwd: os.tmpdir(), shell: true, input: JSON.stringify({ prompt: 'PRIVATE_INPUT_NOT_FOR_OUTPUT' }),
        encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.doesNotMatch(result.stdout, /PRIVATE_INPUT_NOT_FOR_OUTPUT/);
      const context = event === 'SessionStart' ? result.stdout : JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(context, /route_request/);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('Windows npm CLI resolution bypasses the cmd shim and preserves arguments literally', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-cli-'));
  try {
    const bin = path.join(temporary, '工具 with spaces');
    const entry = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(path.join(bin, 'codex.cmd'), 'This shim must not execute');
    const expected = ['plugin', 'marketplace', 'add', path.join(temporary, '中文 & spaces %PATH% !literal!')];
    // A fixture CLI fails if any command-shell interpretation alters an argument.
    fs.writeFileSync(entry, `const assert = require('node:assert/strict'); assert.deepEqual(process.argv.slice(2), ${JSON.stringify(expected)});`);
    const cli = resolveCodex({ platform: 'win32', env: { Path: `"${bin}"` } });
    assert.equal(cli.command, process.execPath);
    assert.deepEqual(cli.prefix, [entry]);
    runCodex(cli, expected);
    fs.writeFileSync(path.join(bin, 'codex.exe'), 'native fixture');
    assert.deepEqual(resolveCodex({ platform: 'win32', env: { PATH: bin } }), { command: path.join(bin, 'codex.exe'), prefix: [] });
    assert.throws(() => resolveCodex({ platform: 'win32', env: {} }), /not found/);
    fs.rmSync(path.join(bin, 'codex.exe'));
    fs.rmSync(entry);
    assert.throws(() => resolveCodex({ platform: 'win32', env: { PATH: bin } }), /npm entry is missing/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('installer creates a portable dedicated marketplace without touching other catalogs', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-marketplace-'));
  try {
    const source = path.join(temporary, '解压目录 with spaces');
    fs.mkdirSync(source);
    fs.copyFileSync(path.join(root, 'plugin.json'), path.join(source, 'plugin.json'));
    fs.writeFileSync(path.join(source, '.mcp.json'), '{}');
    fs.mkdirSync(path.join(source, 'node_modules'));
    fs.writeFileSync(path.join(source, 'node_modules', 'excluded'), 'not runtime');
    fs.mkdirSync(path.join(source, 'dist'));
    fs.writeFileSync(path.join(source, 'dist', 'plugin.zip'), 'release output is not an installed dependency');
    const codexDirectory = path.join(temporary, 'Codex 用户目录');
    const other = path.join(codexDirectory, 'other-marketplace.json');
    fs.mkdirSync(codexDirectory);
    fs.writeFileSync(other, 'unchanged');
    const mainSource = path.join(codexDirectory, 'local-plugin-sources', 'codex-local-privacy-router');
    const mainCatalog = path.join(mainSource, '.agents', 'plugins', 'marketplace.json');
    fs.mkdirSync(path.dirname(mainCatalog), { recursive: true });
    const mainCatalogText = JSON.stringify({ name: 'edge-cloud-collaboration-local', plugins: [] });
    fs.writeFileSync(mainCatalog, mainCatalogText);
    const { marketplace, selector } = prepareMarketplace(source, codexDirectory);
    const catalog = JSON.parse(fs.readFileSync(path.join(marketplace, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    const target = path.resolve(marketplace, catalog.plugins[0].source.path);
    assert.equal(selector, `codex-local-privacy-router-exec@${catalog.name}`);
    assert.equal(catalog.name, 'edge-cloud-collaboration-exec-local');
    assert.equal(marketplace, path.join(codexDirectory, 'local-plugin-sources', 'codex-local-privacy-router-exec'));
    assert.ok(catalog.plugins[0].source.path.startsWith('./plugins/'));
    assert.ok(!catalog.plugins[0].source.path.includes('\\'));
    assert.ok(fs.existsSync(path.join(target, '.mcp.json')));
    assert.ok(!fs.existsSync(path.join(target, 'node_modules')));
    assert.ok(!fs.existsSync(path.join(target, 'dist')));
    assert.equal(fs.readFileSync(other, 'utf8'), 'unchanged');
    // Re-running from the installed source must not copy it into itself.
    assert.deepEqual(prepareMarketplace(target, codexDirectory), { marketplace, selector });
    assert.equal(fs.readFileSync(mainCatalog, 'utf8'), mainCatalogText);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
