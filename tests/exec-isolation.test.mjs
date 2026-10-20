import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Exec settings, drafts and detection ignore main-version state and overrides', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-isolation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const legacy = path.join(directory, 'privacy-router', 'cloud.json');
  const mainFiles = new Map([
    [legacy, JSON.stringify({ provider: 'openai', model: 'main-model' })],
    [`${legacy}.draft.json`, 'main draft must not be read or changed'],
    [`${legacy}.settings.lock`, String(process.pid)],
    [path.join(directory, 'main-detection.json'), 'main detector must not be read'],
  ]);
  for (const [filename, content] of mainFiles) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  const env = { ...process.env, CODEX_HOME: directory,
    PRIVACY_ROUTER_CLOUD_CONFIG: legacy,
    PRIVACY_ROUTER_CONFIG: path.join(directory, 'main-detection.json') };
  for (const key of ['PRIVACY_ROUTER_EXEC_CLOUD_CONFIG', 'PRIVACY_ROUTER_EXEC_CONFIG']) delete env[key];
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { configPath, loadCloudConfig } from ${JSON.stringify(new URL('../mcp/cloud-config.mjs', import.meta.url).href)};
    import { readCloudSettings, updateCloudSettings, applyCloudSettings } from ${JSON.stringify(new URL('../mcp/cloud-settings.mjs', import.meta.url).href)};
    import { loadConfig } from ${JSON.stringify(new URL('../mcp/detection.mjs', import.meta.url).href)};
    const expected = path.join(process.env.CODEX_HOME, 'privacy-router-exec', 'cloud.json');
    assert.equal(configPath(), expected);
    assert.equal(loadCloudConfig(), null);
    assert.equal(readCloudSettings('en').configured, false);
    assert.equal(loadConfig().local_model.enabled, false);
    updateCloudSettings({ model: 'exec-model' }, 'en');
    assert.equal(fs.existsSync(expected + '.draft.json'), true);
    assert.equal(fs.existsSync(expected), false);
    applyCloudSettings('en');
    assert.equal(loadCloudConfig().model, 'exec-model');
    assert.equal(fs.existsSync(expected + '.draft.json'), false);
    assert.equal(fs.existsSync(expected + '.settings.lock'), false);
    process.env.PRIVACY_ROUTER_EXEC_CLOUD_CONFIG = path.join(process.env.CODEX_HOME, 'exec-override.json');
    assert.equal(configPath(), process.env.PRIVACY_ROUTER_EXEC_CLOUD_CONFIG);
    assert.equal(loadCloudConfig(), null);
    const detection = path.join(process.env.CODEX_HOME, 'exec-detection.json');
    fs.writeFileSync(detection, JSON.stringify({ version: 'exec-detector' }));
    process.env.PRIVACY_ROUTER_EXEC_CONFIG = detection;
    assert.equal(loadConfig().version, 'exec-detector');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  for (const [filename, content] of mainFiles) assert.equal(fs.readFileSync(filename, 'utf8'), content);
});
