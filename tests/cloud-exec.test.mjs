import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cloudFixture } from './helpers/cloud-fixture.mjs';
import { validateCloudConfig } from '../mcp/cloud-config.mjs';
import { execArguments } from '../mcp/cloud-exec.mjs';

const assessment = { model: 'local', user_confirmed_small_model: true, complexity: 'complex', sensitivity: 'low', data_scope: 'public', assessment_reason: 'Research public material.' };
function session(fixture) {
  const child = spawn(process.execPath, ['mcp/server.mjs'], { env: fixture.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let id = 0, buffer = '';
  child.stdout.on('data', data => { buffer += data; let at; while ((at = buffer.indexOf('\n')) >= 0) { const value = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); pending.get(value.id)?.(value); pending.delete(value.id); } });
  return { async call(name, args = {}) { const next = ++id; const result = await new Promise(resolve => { pending.set(next, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method: 'tools/call', params: { name, arguments: args } }) + '\n'); }); assert.equal(result.error, undefined); return result.result.structuredContent; }, async close() { await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); } };
}
async function waitJob(s, job) {
  for (let i = 0; i < 200; i++) {
    const result = await s.call('get_cloud_result', { job_id: job.job_id });
    if (result.status !== 'running') return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('job did not finish');
}

test('configuration validation accepts direct keys and rejects invalid credentials, providers, URLs and limits', () => {
  const config = { provider: 'gateway', model: 'vendor-model', base_url: 'https://cloud.example/v1', api_key_env: 'CLOUD_KEY' };
  assert.equal(validateCloudConfig(config).timeout_ms, 180000);
  assert.equal(validateCloudConfig({ ...config, api_key_env: '', api_key: 'sk-synthetic-key' }).api_key, 'sk-synthetic-key');
  for (const extra of [{ provider: '../x' }, { model: '' }, { model: 'x\nmodel_provider=bad' }, { base_url: 'http://cloud.example/v1' }, { base_url: 'https://user:secret@cloud.example' }, { base_url: 'https://cloud.example/?key=secret' }, { api_key_env: 'sk-secret-value' }, { api_key: 'bad key', api_key_env: '' }, { timeout_ms: 0 }, { provider: 'openai' }]) {
    assert.throws(() => validateCloudConfig({ ...config, ...extra }), { code: 'invalid_cloud_config' });
  }
});

test('missing configuration, local persistence, and changed selections fail closed', async () => {
  const f = cloudFixture(); fs.unlinkSync(f.config); let s = session(f);
  try {
    assert.equal((await s.call('select_cloud_model')).error.code, 'cloud_config_required');
    assert.equal((await s.call('open_cloud_settings')).configured, false);
    const config = { provider: 'test-provider', model: 'model-A', base_url: 'https://cloud.example/v1', api_key_env: 'TEST_CLOUD_KEY' };
    assert.equal((await s.call('save_cloud_settings', { config })).ok, true);
    const selected = await s.call('select_cloud_model');
    const route = await s.call('route_request', { ...assessment, prompt: 'Compare public research' });
    await s.call('save_cloud_settings', { config: { ...config, model: 'model-B' } });
    assert.equal((await s.call('run_cloud_analysis', { audience: 'main', model_selection_id: selected.model_selection_id, cloud_request_id: route.cloud_request_id })).error.code, 'model_selection_mismatch');
    assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
    await s.close(); s = session(f);
    assert.equal((await s.call('open_cloud_settings')).config.model, 'model-B');
    assert.equal((await s.call('save_cloud_settings', { config: { ...config, api_key: 'bad key' } })).error.code, 'invalid_cloud_config');
    assert.equal((await s.call('open_cloud_settings')).config.model, 'model-B');
  } finally { await s.close(); f.close(); }
});

test('public cloud execution uses exact assessed input, explicit provider/model, and deduplicates retries', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    const selected = await s.call('select_cloud_model');
    const route = await s.call('route_request', { ...assessment, prompt: 'Compare public sources', context: 'Public context', response_language: 'zh-CN' });
    assert.equal(route.route, 'cloud_exec');
    const args = { audience: 'main', model_selection_id: selected.model_selection_id, cloud_request_id: route.cloud_request_id };
    const job = await s.call('run_cloud_analysis', args);
    assert.equal(job.status, 'running');
    assert.equal(job.provider, 'test-provider');
    assert.equal((await s.call('run_cloud_analysis', args)).job_id, job.job_id);
    const result = await waitJob(s, job), payload = JSON.parse(result.analysis);
    assert.equal(payload.task, 'Compare public sources'); assert.equal(payload.context, 'Public context');
    assert.match(payload.instructions, /BCP 47 tag: zh-CN/);
    assert.equal((await s.call('run_cloud_analysis', { ...args, cloud_request_id: 'forged' })).error.code, 'cloud_request_required');
    assert.equal((await s.call('run_cloud_analysis', { ...args, audience: 'cloud' })).error.code, 'audience_denied');
  } finally { await s.close(); f.close(); }
});

test('sensitive execution requires hash and consent, sends only sanitized input, and cannot replay', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    const selected = await s.call('select_cloud_model');
    const review = await s.call('create_redaction_review', { model: 'local', audience: 'main', content: 'password=PrivateDemo123\nAnalyze delivery timing.' });
    const args = { audience: 'main', model_selection_id: selected.model_selection_id, review_id: review.review_id, expected_sanitized_sha256: review.sanitized_sha256 };
    assert.equal((await s.call('run_cloud_analysis', args)).error.code, 'confirmation_required');
    const consent = await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true });
    args.handoff_token = consent.handoff_token;
    assert.equal((await s.call('run_cloud_analysis', { ...args, expected_sanitized_sha256: undefined })).error.code, 'version_mismatch');
    assert.equal((await s.call('run_cloud_analysis', { ...args, task: 'password=OtherSecret123' })).error.code, 'sensitive_value_detected');
    const jobs = await Promise.all([s.call('run_cloud_analysis', args), s.call('run_cloud_analysis', args)]);
    assert.equal(jobs.filter(job => job.status === 'running').length, 1);
    const result = await waitJob(s, jobs.find(job => job.job_id));
    const payload = JSON.parse(result.analysis);
    assert.deepEqual(Object.keys(payload).sort(), ['instructions', 'sanitized_content', 'task']);
    assert.equal(payload.sanitized_content, review.sanitized_content);
    assert.doesNotMatch(result.analysis, /PrivateDemo123|handoff_token|review_id|original_content/);
    assert.equal((await s.call('confirm_redaction', { audience: 'main', review_id: review.review_id, confirmed: true })).error.code, 'cloud_already_started');
    assert.equal((await s.call('revoke_redaction', { audience: 'main', review_id: review.review_id })).error.code, 'cloud_already_started');
  } finally { await s.close(); f.close(); }
});

test('CLI errors, empty output, timeout and output limits are bounded without diagnostic leakage', async () => {
  const f = cloudFixture(), s = session(f);
  try {
    const config = JSON.parse(fs.readFileSync(f.config)); config.timeout_ms = 1000;
    await s.call('save_cloud_settings', { config });
    const selected = await s.call('select_cloud_model');
    for (const [prompt, code] of [['failure-test', 'cloud_exec_failed'], ['empty-test', 'cloud_exec_empty'], ['timeout-test', 'cloud_exec_timeout'], ['overflow-test', 'cloud_output_too_large']]) {
      const route = await s.call('route_request', { ...assessment, prompt });
      const result = await waitJob(s, await s.call('run_cloud_analysis', { audience: 'main', model_selection_id: selected.model_selection_id, cloud_request_id: route.cloud_request_id }));
      assert.equal(result.error.code, code); assert.doesNotMatch(JSON.stringify(result), /SENSITIVE_DIAGNOSTIC|synthetic-key/);
    }
    f.env.PRIVACY_ROUTER_EXEC_CODEX_BIN = path.join(f.directory, 'missing-codex');
  } finally { await s.close(); f.close(); }
});

test('CLI process gets isolated config, only required credentials, stdin payload and explicit arguments', async () => {
  const f = cloudFixture();
  const output = path.join(f.directory, 'capture.json');
  fs.writeFileSync(f.binary, `#!${process.execPath}\nconst fs = require('node:fs'); let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{ fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),env:process.env,files:fs.readdirSync(process.env.CODEX_HOME),input})); console.log('done'); });`, { mode: 0o700 });
  const direct = JSON.parse(fs.readFileSync(f.config));
  delete direct.api_key_env; direct.api_key = 'sk-direct-synthetic';
  fs.writeFileSync(f.config, JSON.stringify(direct));
  delete f.env.TEST_CLOUD_KEY;
  f.env.UNRELATED_SECRET = 'must-not-inherit';
  const s = session(f);
  try {
    const route = await s.call('route_request', { ...assessment, prompt: 'Task with `shell` and $(commands)' });
    const selected = await s.call('select_cloud_model');
    assert.equal((await waitJob(s, await s.call('run_cloud_analysis', { audience: 'main', model_selection_id: selected.model_selection_id, cloud_request_id: route.cloud_request_id }))).status, 'completed');
    const capture = JSON.parse(fs.readFileSync(output));
    assert.equal(capture.args[0], 'exec'); assert.equal(capture.args.at(-1), '-');
    assert.ok(capture.args.includes('model_provider="test-provider"'));
    assert.equal(capture.args[capture.args.indexOf('--sandbox') + 1], 'danger-full-access');
    assert.ok(capture.args.includes('approval_policy="never"'));
    assert.ok(capture.args.includes('features.shell_tool=true'));
    for (const tool of ['shell_snapshot', 'js_repl', 'apply_patch_freeform', 'view_image', 'goals', 'browser_use', 'computer_use', 'image_generation', 'skill_search']) {
      assert.equal(capture.args.includes(`features.${tool}=false`), false);
    }
    assert.ok(capture.args.includes('web_search="live"'));
    assert.equal(capture.args.includes('Task with `shell` and $(commands)'), false);
    assert.equal(capture.env.UNRELATED_SECRET, undefined);
    assert.equal(capture.env.PRIVACY_CLOUD_API_KEY, 'sk-direct-synthetic');
    assert.doesNotMatch(JSON.stringify(capture.args) + capture.input, /sk-direct-synthetic/);
    assert.deepEqual(capture.files, []);
    assert.equal(fs.existsSync(capture.cwd), false);
    const args = execArguments(validateCloudConfig({ provider: 'openai', model: 'user-model' }), '/tmp/example', { sanitized: true });
    assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('--ephemeral'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'danger-full-access');
  } finally { await s.close(); f.close(); }
});

test('OpenAI runs with a saved key without environment setup or file login', async () => {
  const f = cloudFixture();
  fs.writeFileSync(f.config, JSON.stringify({ provider: 'openai', model: 'test-model', api_key: 'sk-openai-synthetic', timeout_ms: 3000 }));
  delete f.env.CODEX_API_KEY; delete f.env.OPENAI_API_KEY;
  fs.writeFileSync(f.binary, `#!${process.execPath}\nconst fs=require('node:fs'); process.stdin.resume(); process.stdin.on('end',()=>{ if(process.env.CODEX_API_KEY!=='sk-openai-synthetic'||fs.existsSync(process.env.CODEX_HOME+'/auth.json')||process.argv.some(x=>x.includes('sk-openai-synthetic'))) process.exit(2); console.log('authenticated'); });`, { mode: 0o700 });
  const s = session(f);
  try {
    const route = await s.call('route_request', { ...assessment, prompt: 'Compare public documentation' });
    const selected = await s.call('select_cloud_model');
    const result = await waitJob(s, await s.call('run_cloud_analysis', { audience: 'main', model_selection_id: selected.model_selection_id, cloud_request_id: route.cloud_request_id }));
    assert.equal(result.status, 'completed');
    assert.equal(result.analysis, 'authenticated');
  } finally { await s.close(); f.close(); }
});
