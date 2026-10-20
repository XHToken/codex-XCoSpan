import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class CloudError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = () => { throw new CloudError('invalid_cloud_config', 'Check provider, model, HTTPS base URL, API key and timeout.'); };
export function configPath() {
  return process.env.PRIVACY_ROUTER_EXEC_CLOUD_CONFIG || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'privacy-router-exec', 'cloud.json');
}
export function validateCloudConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const allowed = ['provider', 'model', 'base_url', 'api_key', 'api_key_env', 'timeout_ms'];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
  const { provider, model, base_url = '', api_key = '', api_key_env = '', timeout_ms = 180000 } = value;
  if (typeof provider !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(provider)
      || typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)
      || typeof base_url !== 'string' || typeof api_key_env !== 'string'
      || !Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 600000) fail();
  if (api_key_env && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(api_key_env)) fail();
  if (typeof api_key !== 'string' || api_key.length > 4096 || /[\s\x00-\x1f\x7f]/.test(api_key) || (api_key && api_key_env)) fail();
  if (provider === 'openai') {
    if (base_url || api_key_env) fail();
  } else {
    if (['ollama', 'lmstudio', 'amazon-bedrock'].includes(provider) || (!api_key && !api_key_env)) fail();
    let url;
    try { url = new URL(base_url); } catch { fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail();
  }
  return { provider, model: model.trim(), base_url: base_url.replace(/\/+$/, ''), api_key_env, ...(api_key ? { api_key } : {}), timeout_ms };
}
// Never return stored credentials in MCP tool results or repopulate a form with them.
export function publicCloudConfig(config) {
  if (!config) return null;
  const { api_key, ...visible } = config;
  return visible;
}
export function sameCloudDestination(left, right) {
  return Boolean(left && right && left.provider === right.provider
    && (left.base_url || '').replace(/\/+$/, '') === (right.base_url || '').replace(/\/+$/, ''));
}
export function retainCloudCredential(config, active) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  if (config.api_key) return { ...config, api_key_env: '' };
  if (!config.api_key_env && sameCloudDestination(config, active)) {
    return { ...config, ...(active.api_key ? { api_key: active.api_key } : { api_key_env: active.api_key_env }) };
  }
  return config;
}
export function loadCloudConfig() {
  try { return validateCloudConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof CloudError) throw error;
    throw new CloudError('cloud_config_unreadable', 'Cannot read the local cloud configuration.');
  }
}
export function saveCloudConfig(value) {
  const config = validateCloudConfig(value), filename = configPath();
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } catch { throw new CloudError('cloud_config_write_failed', 'Cannot save the local cloud configuration.'); }
  finally { fs.rmSync(temporary, { force: true }); }
  return config;
}
export const configRevision = config => crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
