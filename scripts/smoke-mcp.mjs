import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const child = spawn(process.execPath, [path.join(root, 'mcp/server.mjs'), '--stdio'], {
  cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
});
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let id = 0, failure, closing = false, stderr = '';

function fail(error) {
  if (closing || failure) return;
  failure = error;
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  child.kill('SIGKILL');
}

const timeout = setTimeout(() => fail(new Error('MCP smoke check exceeded its 10-second deadline.')), 10_000);
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
child.once('error', (error) => fail(new Error(`Cannot start MCP server: ${error.message}`)));
child.once('exit', (code, signal) => fail(new Error(`MCP server exited before the check completed (${signal || code}).${stderr ? `\n${stderr.trim()}` : ''}`)));
child.stdin.on('error', (error) => fail(new Error(`Cannot write to MCP server: ${error.message}`)));
rl.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0', 'Server output must use JSON-RPC 2.0');
    if (!Object.hasOwn(message, 'id')) return;
    const request = pending.get(message.id);
    assert.ok(request, `Unexpected JSON-RPC response ID: ${message.id}`);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
    else request.resolve(message.result);
  } catch (error) { fail(new Error(`Invalid MCP response: ${error.message}`)); }
});

function write(message) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function call(method, params = {}) {
  if (failure) return Promise.reject(failure);
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { method, resolve, reject });
    try { write({ id: requestId, method, params }); }
    catch (error) { fail(error); }
  });
}

try {
  const initialized = await call('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'privacy-router-smoke', version: packageInfo.version },
  });
  assert.equal(initialized.serverInfo.name, packageInfo.name, 'MCP name must match package.json');
  assert.equal(initialized.serverInfo.version, packageInfo.version, 'MCP version must match package.json');
  write({ method: 'notifications/initialized' });

  const { tools } = await call('tools/list');
  assert.ok(Array.isArray(tools), 'tools/list must return a tools array');
  for (const name of ['check_model', 'route_request', 'select_subagent_model', 'detect_sensitive_content', 'create_redaction_review', 'preview_redaction', 'confirm_redaction', 'revoke_redaction', 'handoff_to_subagent']) {
    assert.ok(tools.some((tool) => tool.name === name), `Missing core tool: ${name}`);
  }
  const uri = tools.find((tool) => tool.name === 'create_redaction_review')._meta?.ui?.resourceUri;
  assert.ok(typeof uri === 'string' && uri.startsWith('ui://'), 'Review tool must reference its UI resource');
  const { resources } = await call('resources/list');
  assert.ok(Array.isArray(resources) && resources.some((resource) => resource.uri === uri), 'resources/list must advertise the review UI');
  const { contents } = await call('resources/read', { uri });
  const ui = contents?.find((resource) => resource.uri === uri);
  assert.ok(ui && ui.mimeType === 'text/html;profile=mcp-app' && typeof ui.text === 'string', 'resources/read must return the embedded HTML UI');
  assert.match(ui.text, /<!doctype html>/i, 'Review UI must be an HTML document');
  assert.match(ui.text, /<script\b[^>]*>[\s\S]+<\/script>/i, 'Review UI must include its bundled script');
  assert.ok(!ui.text.includes('/* REVIEW_SCRIPT */'), 'Review UI must be built before use');
  console.log(`MCP smoke check passed: ${packageInfo.name} ${packageInfo.version}, ${tools.length} tools, embedded UI loaded from another working directory.`);
} catch (error) {
  console.error(`MCP smoke check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closing = true;
  clearTimeout(timeout);
  rl.close();
  child.stdin.end();
  child.kill('SIGKILL');
}
