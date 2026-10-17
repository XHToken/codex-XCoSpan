import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filename) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));
    check(value && typeof value === 'object' && !Array.isArray(value), 'expected a JSON object');
    return value;
  }
  catch (error) { throw new Error(`${filename}: ${error.message}`); }
}

function same(actual, expected, label) {
  check(isDeepStrictEqual(actual, expected), `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

// Both manifest formats resolve local entries from the plugin root. Keep their
// different spellings (${PLUGIN_ROOT}/... and ./...) in the source manifests.
function checkPath(value, label, expected, kind = 'file') {
  check(typeof value === 'string' && value.length > 0, `${label}: expected a local ${kind} path`);
  const resolved = path.resolve(root, value.replace(/^\$\{PLUGIN_ROOT\}(?=\/|$)/, () => root));
  same(resolved, path.resolve(root, expected), `${label} resolved path`);
  let stat;
  try { stat = fs.statSync(resolved); }
  catch (error) { throw new Error(`${label}: cannot read ${expected} (${error.code})`); }
  check(kind === 'directory' ? stat.isDirectory() : stat.isFile(), `${label}: ${expected} must be a ${kind}`);
}

function main() {
  const packageInfo = readJson('package.json');
  const standard = readJson('plugin.json');
  const codex = readJson('.codex-plugin/plugin.json');

  for (const field of ['name', 'version', 'description', 'license']) {
    check(typeof packageInfo[field] === 'string' && packageInfo[field].length > 0, `package.json.${field}: expected a nonempty string`);
    same(standard[field], packageInfo[field], `plugin.json.${field}`);
    same(codex[field], packageInfo[field], `.codex-plugin/plugin.json.${field}`);
  }
  for (const field of ['author', 'keywords']) {
    same(codex[field], standard[field], `.codex-plugin/plugin.json.${field} versus plugin.json`);
  }

  const openai = standard.extensions?.['com.openai'];
  check(openai?.interface && typeof openai.interface === 'object' && !Array.isArray(openai.interface), 'plugin.json.extensions.com.openai.interface: expected an object');
  same(codex.interface, openai.interface, '.codex-plugin/plugin.json.interface versus plugin.json.extensions.com.openai.interface');
  for (const [label, config] of [['plugin.json.extensions.com.openai', openai], ['.codex-plugin/plugin.json', codex]]) {
    checkPath(config.hooks, `${label}.hooks`, 'hooks.json');
    for (const field of ['logo', 'composerIcon']) {
      checkPath(config.interface[field], `${label}.interface.${field}`, 'assets/lock.svg');
    }
  }
  checkPath(codex.mcpServers, '.codex-plugin/plugin.json.mcpServers', '.mcp.json');
  checkPath(codex.skills, '.codex-plugin/plugin.json.skills', 'skills', 'directory');
  for (const filename of ['skills/privacy-routing/SKILL.md', 'skills/privacy-routing/references/routing-policy.md']) {
    checkPath(filename, 'Privacy routing skill resource', filename);
  }

  for (const filename of ['mcp.json', '.mcp.json']) {
    const config = readJson(filename);
    same(Object.keys(config.mcpServers || {}), ['privacy-router'], `${filename}.mcpServers entries`);
    const server = config.mcpServers['privacy-router'];
    check(server && typeof server === 'object', `${filename}.mcpServers.privacy-router: expected an object`);
    same(server.command, 'node', `${filename}.mcpServers.privacy-router.command`);
    if (filename === 'mcp.json' || server.type !== undefined) same(server.type, 'stdio', `${filename}.mcpServers.privacy-router.type`);
    check(Array.isArray(server.args) && server.args.length === 2, `${filename}.mcpServers.privacy-router.args: expected the server path and --stdio`);
    checkPath(server.args[0], `${filename}.mcpServers.privacy-router.args[0]`, 'mcp/server.mjs');
    same(server.args[1], '--stdio', `${filename}.mcpServers.privacy-router.args[1]`);
    checkPath(server.cwd, `${filename}.mcpServers.privacy-router.cwd`, '.', 'directory');
  }

  const hooks = readJson('hooks.json').hooks;
  const hookEntries = { SessionStart: 'hooks/session-start.mjs', UserPromptSubmit: 'hooks/prompt-routing.mjs' };
  same(Object.keys(hooks || {}).sort(), Object.keys(hookEntries).sort(), 'hooks.json event entries');
  for (const [event, entry] of Object.entries(hookEntries)) {
    check(Array.isArray(hooks[event]) && hooks[event].length > 0, `hooks.json.${event}: expected at least one hook group`);
    for (const [groupIndex, group] of hooks[event].entries()) {
      const label = `hooks.json.${event}[${groupIndex}].hooks`;
      check(Array.isArray(group?.hooks) && group.hooks.length > 0, `${label}: expected at least one command`);
      for (const [hookIndex, hook] of group.hooks.entries()) {
        check(hook && typeof hook === 'object', `${label}[${hookIndex}]: expected a command hook`);
        same(hook.type, 'command', `${label}[${hookIndex}].type`);
        const commandPath = typeof hook.command === 'string' && /^node "(\$\{PLUGIN_ROOT\}\/[^"\r\n]+)"$/.exec(hook.command)?.[1];
        check(commandPath, `${label}[${hookIndex}].command: expected node followed by a quoted ${'${PLUGIN_ROOT}'}/ path`);
        checkPath(commandPath, `${label}[${hookIndex}].command`, entry);
      }
    }
  }

  for (const filename of ['shared/messages.mjs', 'mcp/detection-worker.mjs', 'ui/contract-redaction-review.html']) {
    checkPath(filename, 'Required runtime resource', filename);
  }
  console.log('Plugin manifests, shared metadata, and runtime paths are consistent.');
}

try { main(); }
catch (error) { console.error(`Manifest check failed: ${error.message}`); process.exitCode = 1; }
