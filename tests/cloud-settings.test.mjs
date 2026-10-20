import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { cloudFixture } from './helpers/cloud-fixture.mjs';

function session(fixture) {
  const child = spawn(process.execPath, ['mcp/server.mjs'], { env: fixture.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let id = 0, buffer = '';
  child.stdout.on('data', data => {
    buffer += data; let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const response = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
      const request = pending.get(response.id); pending.delete(response.id); request?.resolve(response);
    }
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('MCP exited')); pending.clear(); });
  return {
    async rpc(method, params = {}) {
      const next = ++id;
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(next); reject(new Error('MCP timeout')); }, 10_000);
        pending.set(next, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
      });
      assert.equal(response.error, undefined); return response.result;
    },
    async call(name, args = {}) { return (await this.rpc('tools/call', { name, arguments: args })).structuredContent; },
    async close() { if (child.exitCode !== null) return; await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); },
  };
}

test('settings discovery works before a conversation; drafts survive restart and do not activate a model', async () => {
  const f = cloudFixture(); fs.rmSync(f.config); let s = session(f);
  try {
    const initialized = await s.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'settings-host', version: '1' } });
    assert.deepEqual(initialized.capabilities.extensions['openai/settings'], { readTool: 'cloud_settings_read', updateTool: 'cloud_settings_update' });
    const { tools } = await s.rpc('tools/list');
    for (const name of ['cloud_settings_read', 'cloud_settings_update', 'cloud_settings_apply', 'cloud_settings_reset']) {
      assert.ok(tools.some(tool => tool.name === name));
      assert.deepEqual(tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
    }
    const open = tools.find(tool => tool.name === 'open_cloud_settings');
    assert.equal(open._meta['openai/ui'].entrypoints[0].type, 'settings');
    assert.match(open._meta.ui.resourceUri, /^ui:\/\//);
    let form = await s.call('cloud_settings_read', { response_language: 'zh-CN' });
    assert.match(form.layout[0].title, /尚未配置/);
    assert.equal(form.values.model, '');
    assert.equal(form.schema.properties.base_url, undefined);
    assert.equal((await s.call('cloud_settings_apply')).error.code, 'cloud_model_required');
    await s.call('cloud_settings_update', { set: { model: 'chosen-model' } });
    assert.equal(fs.existsSync(f.config), false);
    assert.equal((await s.call('select_cloud_model')).error.code, 'cloud_config_required');
    assert.equal(fs.statSync(`${f.config}.draft.json`).mode & 0o777, 0o600);
    await s.close(); s = session(f);
    form = await s.call('cloud_settings_read');
    assert.equal(form.has_draft, true); assert.equal(form.values.model, 'chosen-model');
    const applied = await s.rpc('tools/call', { name: 'cloud_settings_apply', arguments: { response_language: 'zh-CN' } });
    assert.equal(applied.isError, false); assert.match(applied.content[0].text, /配置已应用/);
    assert.equal(applied.structuredContent.has_draft, false);
    assert.equal((await s.call('select_cloud_model')).selected_model, 'chosen-model');
    assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(`${f.config}.draft.json`), false);
  } finally { await s.close(); f.close(); }
});

test('custom settings use progressive fields and atomic apply; invalid drafts preserve the active model', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    const before = fs.readFileSync(f.config, 'utf8');
    await s.call('cloud_settings_update', { set: { provider_type: 'OpenAI / ChatGPT' } });
    let form = await s.call('cloud_settings_read');
    assert.equal(form.schema.properties.api_key_env, undefined);
    form = await s.call('cloud_settings_update', { set: { provider_type: 'Custom', model: '', base_url: 'http://example.invalid' } });
    assert.equal(form.schema.properties.base_url.type, 'string');
    assert.equal(form.values.provider_id, 'test-provider');
    assert.equal((await s.call('cloud_settings_apply')).error.code, 'cloud_model_required');
    await s.call('cloud_settings_update', { set: { model: 'next-model' } });
    assert.equal((await s.call('cloud_settings_apply')).error.code, 'cloud_url_invalid');
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    await s.call('cloud_settings_update', { set: { base_url: 'https://cloud.example/v1', timeout_seconds: 1.001 } });
    const applied = await s.call('cloud_settings_apply');
    assert.equal(applied.configured, true);
    const config = JSON.parse(fs.readFileSync(f.config));
    assert.equal(config.model, 'next-model'); assert.equal(config.timeout_ms, 1001);
    await s.call('cloud_settings_update', { set: { model: 'discard-this' } });
    const reset = await s.call('cloud_settings_reset');
    assert.equal(reset.values.model, 'next-model'); assert.equal(reset.has_draft, false);
    assert.equal((await s.call('select_cloud_model')).selected_model, 'next-model');
  } finally { await s.close(); f.close(); }
});

test('another process changing active settings cannot be overwritten by an old draft or open page', async () => {
  const f = cloudFixture(), s = session(f), second = session(f);
  try {
    const page = await s.call('open_cloud_settings');
    await s.call('cloud_settings_update', { set: { model: 'draft-model' } });
    const external = { ...page.active_config, model: 'external-model' };
    fs.writeFileSync(f.config, JSON.stringify(external));
    assert.equal((await second.call('cloud_settings_read')).conflict, true);
    assert.equal((await s.call('cloud_settings_apply')).error.code, 'cloud_settings_conflict');
    assert.equal((await s.call('cloud_settings_update', { set: { model: 'wrong-model' } })).error.code, 'cloud_settings_conflict');
    assert.equal((await s.call('save_cloud_settings', { config: page.config, expected_revision: page.config_revision })).error.code, 'cloud_settings_conflict');
    assert.equal((await second.call('select_cloud_model')).selected_model, 'external-model');
    await second.call('cloud_settings_reset');
    assert.equal((await s.call('cloud_settings_read')).values.model, 'external-model');
  } finally { await s.close(); await second.close(); f.close(); }
});

test('draft validation rejects unknown keys, secret-like environment names and invalid types without echoing input', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    for (const set of [{ api_key: 'SECRET_TEST_VALUE' }, { api_key_env: 'sk-SECRET_TEST_VALUE' }, { model: 'line\nbreak' }, { timeout_seconds: 0 }, { model: null }, { provider_type: 'unknown' }, {}]) {
      const result = await s.call('cloud_settings_update', { set });
      assert.equal(result.error.code, 'invalid_settings_patch');
      assert.doesNotMatch(JSON.stringify(result), /SECRET_TEST_VALUE/);
    }
    assert.equal(fs.existsSync(`${f.config}.draft.json`), false);
    fs.writeFileSync(`${f.config}.draft.json`, 'broken');
    assert.equal((await s.call('cloud_settings_read')).error.code, 'cloud_draft_unreadable');
    assert.equal((await s.call('cloud_settings_reset')).values.model, 'test-large');
    assert.equal((await s.call('select_cloud_model')).selected_model, 'test-large');
  } finally { await s.close(); f.close(); }
});

test('a live settings writer is respected and released locks allow retry', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    fs.writeFileSync(`${f.config}.settings.lock`, String(process.pid));
    assert.equal((await s.call('cloud_settings_update', { set: { model: 'new' } })).error.code, 'cloud_settings_busy');
    assert.equal((await s.call('select_cloud_model')).selected_model, 'test-large');
    fs.rmSync(`${f.config}.settings.lock`);
    assert.equal((await s.call('cloud_settings_update', { set: { model: 'new' } })).values.model, 'new');
  } finally { await s.close(); f.close(); }
});


test('direct keys persist privately, never echo, survive edits, and cannot follow a changed destination', async () => {
  const f = cloudFixture(); let s = session(f);
  const key = 'sk-synthetic-direct-only';
  const config = { provider: 'custom', model: 'chosen', base_url: 'https://gateway.example/v1', api_key: key };
  try {
    const saved = await s.rpc('tools/call', { name: 'save_cloud_settings', arguments: { config } });
    assert.equal(saved.isError, false);
    assert.doesNotMatch(JSON.stringify(saved), /sk-synthetic-direct-only/);
    assert.equal(saved.structuredContent.api_key_saved, true);
    assert.equal(JSON.parse(fs.readFileSync(f.config)).api_key, key);
    assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
    await s.close(); s = session(f);
    for (const name of ['open_cloud_settings', 'cloud_settings_read', 'select_cloud_model']) {
      assert.doesNotMatch(JSON.stringify(await s.rpc('tools/call', { name, arguments: {} })), /sk-synthetic-direct-only/);
    }
    const form = await s.call('cloud_settings_read');
    assert.equal(form.schema.properties.api_key_env, undefined);
    assert.equal(form.schema.properties.api_key, undefined); // Native text fields cannot mask passwords.
    await s.call('cloud_settings_update', { set: { model: 'new-model' } });
    assert.doesNotMatch(fs.readFileSync(`${f.config}.draft.json`, 'utf8'), /sk-synthetic-direct-only/);
    assert.equal((await s.call('cloud_settings_apply')).configured, true);
    assert.equal(JSON.parse(fs.readFileSync(f.config)).api_key, key);
    let page = await s.call('open_cloud_settings');
    assert.equal((await s.call('save_cloud_settings', { config: { ...page.config, api_key: '', model: 'next-model' }, expected_revision: page.config_revision })).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(f.config)).api_key, key);
    page = await s.call('open_cloud_settings');
    const moved = { ...page.config, base_url: 'https://different.example/v1', api_key: '' };
    assert.equal((await s.call('save_cloud_settings', { config: moved })).ok, false);
    assert.equal(JSON.parse(fs.readFileSync(f.config)).base_url, config.base_url);
    await s.call('cloud_settings_update', { set: { base_url: moved.base_url } });
    assert.equal((await s.call('cloud_settings_apply')).error.code, 'cloud_key_required');
    assert.equal((await s.call('save_cloud_settings', { config: { ...moved, api_key: 'sk-replacement-synthetic' } })).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(f.config)).api_key, 'sk-replacement-synthetic');
    const stale = await s.call('save_cloud_settings', { config, expected_revision: page.config_revision });
    assert.equal(stale.error.code, 'cloud_settings_conflict');
    assert.doesNotMatch(JSON.stringify(stale), /sk-synthetic-direct-only/);
  } finally { await s.close(); f.close(); }
});
