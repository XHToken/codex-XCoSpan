import assert from 'node:assert/strict';
import test from 'node:test';
import { detectContent, validateConfig, parseModelFindings, chunks } from '../mcp/detection.mjs';
import { boundary } from '../mcp/detection-core.mjs';

const modelConfig = (extra = {}) => validateConfig({ local_model: { enabled: true, base_url: 'http://127.0.0.1:11434/v1', model: 'local-test', ...extra } });
const response = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });

test('general detection separates strict identifiers from contextual business facts and uses UTF-16', async () => {
  const text = '😀联系人：张三。公司：示例科技有限公司。金额128万元；日期2026-10-16；password=DemoSecret123。保留这句话';
  const result = await detectContent(text);
  const person = result.findings.find((f) => f.type === 'person');
  assert.equal(text.slice(person.start, person.end), '张三');
  assert.equal(person.start, 6);
  for (const type of ['amount', 'date', 'organization', 'person']) assert.equal(result.findings.find((f) => f.type === type).protection, 'contextual');
  assert.equal(result.findings.find((f) => f.type === 'secret').protection, 'required');
  const secret = result.findings.find((f) => f.type === 'secret');
  assert.equal(text.slice(secret.start, secret.end), 'DemoSecret123');
  assert.doesNotMatch(JSON.stringify(result), /DemoSecret123|张三|示例科技/);
});

test('enterprise dictionary is literal, respects word boundaries and can require protection', async () => {
  const config = validateConfig({ dictionary: [{ term: 'Orion+', type: 'project_code', action: 'mask' }, { term: 'Alpha', type: 'organization' }] });
  const text = 'Orion+ / orion+ / Alpha / Alphabet';
  const result = await detectContent(text, { config });
  assert.equal(result.findings.filter((f) => f.type === 'project_code').length, 2);
  assert.equal(result.findings.filter((f) => f.type === 'organization').length, 1);
  assert.ok(result.findings.filter((f) => f.type === 'project_code').every((f) => f.protection === 'required'));
});

test('exact repeated people propagate without masking longer place names', async () => {
  const text = '联系人：张三。张三负责说明。张三路不应当作同一人。';
  const result = await detectContent(text);
  const people = result.findings.filter((f) => f.type === 'person');
  assert.equal(people.length, 2);
  assert.ok(people.every((f) => text.slice(f.start, f.end) === '张三'));
});

test('required dictionary protection survives agreement from the local model', async () => {
  const config = modelConfig();
  config.dictionary = [{ term: 'Orion', type: 'project_code', action: 'mask' }];
  const result = await detectContent('Orion', { config, fetchImpl: async () => response({ findings: [{ type: 'project_code', start: 0, end: 5, text: 'Orion' }] }) });
  assert.equal(result.findings[0].protection, 'required');
  assert.ok(result.findings[0].sources.includes('local_model'));
});

test('configuration rejects silent downgrades, typos, invalid regex and untrusted endpoints', () => {
  for (const input of [{ categories: { secret: 'contextual' } }, { dictionary: [{}] }, { rules: [{ type: 'custom', pattern: '[' }] }, { local_modle: {} }]) assert.throws(() => validateConfig(input));
  assert.throws(() => modelConfig({ base_url: 'https://example.com/v1' }), /untrusted_model_endpoint/);
  assert.throws(() => modelConfig({ base_url: 'http://internal.test/v1', trusted_origins: ['http://internal.test'] }), /untrusted_model_endpoint/);
  assert.equal(modelConfig({ base_url: 'https://internal.test/v1', trusted_origins: ['https://internal.test'] }).local_model.enabled, true);
});

test('malformed findings and Unicode-splitting offsets fail closed', () => {
  const allowed = new Set(['person']);
  for (const payload of [{}, { findings: null }, { findings: [{}] }, { findings: [{ type: 'unknown', start: 2, end: 4, text: '张三' }] }, { findings: [{ type: 'person', start: 1, end: 3, text: '\ude00张' }] }]) assert.throws(() => parseModelFindings(payload, '😀张三', allowed), /invalid_model_output/);
  assert.deepEqual(parseModelFindings({ findings: [] }, '😀张三', allowed), []);
  assert.equal(parseModelFindings({ findings: [{ type: 'person', start: 2, end: 4, text: '张三' }] }, '😀张三', allowed)[0].start, 2);
});

test('model schema failure is not interpreted as zero findings', async () => {
  for (const body of [{}, { findings: [{ type: 'person', start: 99, end: 101, text: '张三' }] }]) {
    await assert.rejects(detectContent('联系人：张三', { config: modelConfig(), fetchImpl: async () => response(body) }), /invalid_model_output/);
  }
});

test('overlapping model chunks retain boundary entities and merge duplicate detections', async () => {
  const text = '甲'.repeat(508) + 'Orion' + '乙'.repeat(600) + '😀';
  let calls = 0;
  const result = await detectContent(text, { config: modelConfig({ chunk_chars: 512, overlap_chars: 64 }), fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error');
    const chunk = JSON.parse(JSON.parse(init.body).messages[1].content).text;
    const start = chunk.indexOf('Orion');
    return response({ findings: start < 0 ? [] : [{ type: 'project_code', start, end: start + 5, text: 'Orion' }] });
  } });
  assert.ok(calls > 1);
  assert.equal(result.findings.filter((f) => f.type === 'project_code').length, 1);
  assert.equal(result.findings.find((f) => f.type === 'project_code').start, 508);
  for (const chunk of chunks('😀'.repeat(1000), 513, 65)) assert.ok(boundary('😀'.repeat(1000), chunk.offset) && boundary('😀'.repeat(1000), chunk.offset + chunk.text.length));
});

test('custom regex runs in a terminable worker and invalid rules never disappear silently', async () => {
  await assert.rejects(detectContent('a'.repeat(30000) + '!', { config: validateConfig({ rule_timeout_ms: 100 }), patterns: [{ name: 'slow', pattern: '(a+)+$' }] }), /rule_detection_timeout/);
  await assert.rejects(detectContent('demo', { patterns: [{ name: 'bad', pattern: '[' }] }), /invalid_custom_patterns/);
  const next = await detectContent('password=OtherSecret123');
  assert.ok(next.findings.some((f) => f.type === 'secret'));
});

test('model transport failures and missing credentials expose only safe codes', async () => {
  await assert.rejects(detectContent('private fixture', { config: modelConfig(), fetchImpl: async () => { throw new Error('private fixture secret response'); } }), (e) => e.message === 'model_unavailable');
  await assert.rejects(detectContent('private fixture', { config: modelConfig({ api_key_env: 'TEST_ONLY_TOKEN' }), env: {}, fetchImpl: async () => assert.fail('must not call endpoint') }), /missing_model_credential/);
});

test('optional model total timeout cancels inference and oversized responses are rejected', async () => {
  await assert.rejects(detectContent('synthetic fixture', { config: modelConfig({ timeout_ms: 100 }), fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test timeout')), 3000);
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) }), /model_detection_timeout/);
  await assert.rejects(detectContent('synthetic fixture', { config: modelConfig(), fetchImpl: async () => new Response('x'.repeat(1000001)) }), /invalid_model_output/);
});
