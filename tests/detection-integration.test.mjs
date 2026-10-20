import { cloudFixture } from './helpers/cloud-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

function rpc(env = {}) {
  const fixture = cloudFixture();
  const child = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname], { env: { ...fixture.env, PRIVACY_ROUTER_CONFIG: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, buffer = '', stderr = ''; const pending = new Map();
  child.stderr.on('data', (v) => { stderr += v; });
  child.stdout.on('data', (v) => { buffer += v; let at; while ((at = buffer.indexOf('\n')) >= 0) { const result = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); pending.get(result.id)?.(result.result); pending.delete(result.id); } });
  return { call(name, args = {}) { const next = ++id; return new Promise((resolve) => { pending.set(next, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method: 'tools/call', params: { name, arguments: args } }) + '\n'); }); }, close() { child.kill(); child.once('exit', () => fixture.close()); }, stderr: () => stderr };
}
const create = (s, content, extra = {}) => s.call('create_redaction_review', { model: 'local', audience: 'main', content, sensitive_spans: [], ...extra });
const data = (r) => r.structuredContent;

test('Codex inspection has no raw values and strict masks survive structured revisions', async () => {
  const s = rpc();
  try {
    const content = '原有【secret1】；password=DemoSecret123；金额128万元，日期2026-10-16。';
    const inspect = data(await s.call('detect_sensitive_content', { audience: 'main', content }));
    assert.equal(inspect.ok, true);
    assert.doesNotMatch(JSON.stringify(inspect), /DemoSecret123|128万/);
    const review = data(await create(s, content));
    assert.equal(review.ok, true);
    assert.match(review.sanitized_content, /【secret2】/);
    assert.doesNotMatch(review.sanitized_content, /DemoSecret123/);
    assert.match(review.sanitized_content, /金额128万元，日期2026-10-16/);
    const confirmed = data(await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true }));
    const revised = data(await s.call('preview_redaction', { audience: 'main', review_id: review.review_id, sensitive_spans: [], expected_sanitized_sha256: review.sanitized_sha256 }));
    assert.equal(revised.sanitized_content, review.sanitized_content);
    assert.equal(revised.handoff_token, confirmed.handoff_token);
    assert.equal(revised.status, 'confirmed');
  } finally { s.close(); }
});

test('hard protection cannot bypass routing and task text is independently checked', async () => {
  const s = rpc();
  try {
    const route = data(await s.call('route_request', { model: 'local', user_confirmed_small_model: true, prompt: 'Analyze password=DemoSecret123', complexity: 'complex', sensitivity: 'low', data_scope: 'public', assessment_reason: 'Claimed public content.' }));
    assert.equal(route.route, 'redaction_required');
    assert.equal(route.sensitivity.source, 'required_detectors');
    const review = data(await create(s, '普通说明文字'));
    const confirmed = data(await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true }));
    const selected = data(await s.call('select_cloud_model', { available_models: ['test-large'], large_model_ids: ['test-large'] }));
    const args = { audience: 'main', expected_sanitized_sha256: review.sanitized_sha256, review_id: review.review_id, handoff_token: confirmed.handoff_token, model: 'test-large', model_selection_id: selected.model_selection_id };
    const denied = data(await s.call('run_cloud_analysis', { ...args, task: 'password=NewSecret123' }));
    assert.equal(denied.error.code, 'sensitive_value_detected');
    assert.doesNotMatch(JSON.stringify(denied), /NewSecret123/);
    const allowed = data(await s.call('run_cloud_analysis', { ...args, task: '分析说明' }));
    assert.equal(allowed.status, 'running');
    assert.ok(allowed.job_id);
  } finally { s.close(); }
});

test('same-type overlapping spans union fully and split emoji offsets are rejected', async () => {
  const s = rpc();
  try {
    const merged = data(await create(s, 'abcdef', { sensitive_spans: [{ type: 'secret', start: 0, end: 4 }, { type: 'secret', start: 2, end: 6 }] }));
    assert.equal(merged.sanitized_content, '【secret1】');
    const bad = data(await create(s, '😀张三', { sensitive_spans: [{ type: 'person', start: 1, end: 4 }] }));
    assert.equal(bad.error.code, 'invalid_sensitive_spans');
  } finally { s.close(); }
});

test('configuration changes invalidate consent; invalid config blocks previews without exposing its contents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-config-'));
  const file = path.join(dir, 'private.json');
  fs.writeFileSync(file, JSON.stringify({ dictionary: [{ term: 'Orion', type: 'project_code', action: 'mask' }] }));
  const s = rpc({ PRIVACY_ROUTER_CONFIG: file });
  try {
    const review = data(await create(s, 'Orion 文档'));
    assert.doesNotMatch(review.sanitized_content, /Orion/);
    await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true });
    fs.writeFileSync(file, JSON.stringify({ version: '2' }));
    const stale = data(await s.call('preview_redaction', { audience: 'main', review_id: review.review_id }));
    assert.equal(stale.error.code, 'detection_policy_changed');
    fs.writeFileSync(file, '{ PRIVATE_CONFIGURATION_SECRET');
    const broken = await create(s, '文档');
    assert.equal(data(broken).error.code, 'invalid_detection_config');
    assert.doesNotMatch(JSON.stringify(broken) + s.stderr(), /PRIVATE_CONFIGURATION_SECRET/);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('model schema errors block review and concurrent revocation wins over in-flight handoff', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-model-'));
  let mode = 'invalid', release, entered;
  const waiting = new Promise((r) => { entered = r; });
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* discard synthetic fixture */ }
    if (mode === 'hold') { entered(); await new Promise((r) => { release = r; }); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(mode === 'invalid' ? {} : { findings: [] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ local_model: { enabled: true, base_url: `http://127.0.0.1:${server.address().port}/v1`, model: 'synthetic-test' } }));
  const s = rpc({ PRIVACY_ROUTER_CONFIG: file });
  try {
    const broken = data(await create(s, '普通说明'));
    assert.equal(broken.error.code, 'invalid_model_output');
    mode = 'valid';
    const review = data(await create(s, '普通说明'));
    const confirmed = data(await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true }));
    const selected = data(await s.call('select_cloud_model', { available_models: ['test-large'], large_model_ids: ['test-large'] }));
    mode = 'hold';
    const pending = s.call('run_cloud_analysis', { expected_sanitized_sha256: review.sanitized_sha256, audience: 'main', review_id: review.review_id, handoff_token: confirmed.handoff_token, model: 'test-large', model_selection_id: selected.model_selection_id, task: '分析说明' });
    await waiting;
    await s.call('revoke_redaction', { audience: 'main', review_id: review.review_id });
    release();
    assert.equal(data(await pending).error.code, 'version_mismatch');
  } finally { release?.(); s.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
