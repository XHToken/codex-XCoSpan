import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function cloudFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-cloud-test-'));
  const config = path.join(directory, 'cloud.json');
  fs.writeFileSync(config, JSON.stringify({ provider: 'test-provider', model: 'test-large', base_url: 'https://cloud.example/v1', api_key_env: 'TEST_CLOUD_KEY', timeout_ms: 3000 }));
  const binary = path.join(directory, 'codex');
  fs.writeFileSync(binary, `#!${process.execPath}\n` + fs.readFileSync(fileURLToPath(new URL('./fake-codex.txt', import.meta.url)), 'utf8'), { mode: 0o700 });
  return { directory, config, binary, env: { ...process.env, PRIVACY_ROUTER_EXEC_CLOUD_CONFIG: config, PRIVACY_ROUTER_EXEC_CODEX_BIN: binary, TEST_CLOUD_KEY: 'synthetic-key' }, close() { fs.rmSync(directory, { recursive: true, force: true }); } };
}
