#!/usr/bin/env node
// Optional installer for clients without a plugin ZIP import entry point.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function resolveCodex({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command: 'codex', prefix: [] };
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const directory of searchPath.split(';').filter(Boolean)) {
    const base = directory.replace(/^"(.*)"$/, '$1');
    const executable = path.join(base, 'codex.exe');
    if (fs.existsSync(executable)) return { command: executable, prefix: [] };
    const shim = path.join(base, 'codex.cmd');
    if (fs.existsSync(shim)) {
      // Run the npm entry with Node directly. Avoid cmd.exe quoting and .cmd
      // execution restrictions in child_process, including paths with spaces.
      const entry = path.join(base, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (fs.existsSync(entry)) return { command: process.execPath, prefix: [entry] };
      throw new Error('Found codex.cmd but its npm entry is missing. Repair the Codex npm installation or put a native codex.exe on PATH.');
    }
  }
  throw new Error('Codex CLI was not found on PATH. Install it, reopen the terminal, and verify codex plugin --help.');
}

export function runCodex(cli, args) {
  const result = spawnSync(cli.command, [...cli.prefix, ...args], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Codex command failed (${result.status ?? result.signal}). Check the output above.`);
}

export function prepareMarketplace(source, codexDirectory) {
  const plugin = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
  const marketplaceName = 'edge-cloud-collaboration-local';
  const marketplace = path.resolve(codexDirectory, 'local-plugin-sources', plugin.name);
  const relativePlugin = `./plugins/${plugin.name}-${plugin.version}`;
  const destination = path.resolve(marketplace, relativePlugin);
  if (path.resolve(source) !== destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      filter: (entry) => !['node_modules', '.git', '.DS_Store'].includes(path.basename(entry)),
    });
  }
  const catalog = path.join(marketplace, '.agents', 'plugins', 'marketplace.json');
  fs.mkdirSync(path.dirname(catalog), { recursive: true });
  fs.writeFileSync(catalog, JSON.stringify({
    name: marketplaceName,
    interface: { displayName: 'Edge-Cloud Collaboration Local' },
    plugins: [{ name: plugin.name, source: { source: 'local', path: relativePlugin },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  }, null, 2) + '\n');
  return { marketplace, selector: `${plugin.name}@${marketplaceName}` };
}

function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node install.mjs\nSupports Windows, macOS and Linux. Requires Node.js 20+ and Codex CLI with plugin commands.\nCopies this plugin into the Codex user directory and installs through a dedicated local marketplace.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
  const cli = resolveCodex();
  runCodex(cli, ['plugin', '--help']);
  const source = path.dirname(fileURLToPath(import.meta.url));
  const directory = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const { marketplace, selector } = prepareMarketplace(source, directory);
  runCodex(cli, ['plugin', 'marketplace', 'add', marketplace]);
  runCodex(cli, ['plugin', 'add', selector]);
  console.log('Installed. Review/trust the plugin hooks when prompted and start a new chat.');
}

if (process.argv[1] && fs.existsSync(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
