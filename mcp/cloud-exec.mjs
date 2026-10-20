import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CloudError } from './cloud-config.mjs';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const activeRuns = new Map();
let shuttingDown = false;
export function runCloudExec(config, payload, options = {}) {
  if (shuttingDown) return Promise.reject(new CloudError('cloud_exec_cancelled', 'The MCP service is stopping.'));
  const controller = new AbortController();
  const promise = execute(config, payload, { ...options, signal: controller.signal });
  activeRuns.set(controller, promise);
  promise.then(() => activeRuns.delete(controller), () => activeRuns.delete(controller));
  return promise;
}
export async function shutdownCloudExec() {
  shuttingDown = true;
  const pending = [...activeRuns.values()];
  for (const controller of activeRuns.keys()) controller.abort();
  await Promise.allSettled(pending);
}
export function execArguments(config, directory, { sanitized = false } = {}) {
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'danger-full-access', '--color', 'never', '--cd', directory, '--model', config.model];
  const settings = {
    model_provider: config.provider, approval_policy: 'never', project_doc_max_bytes: 0,
    web_search: sanitized ? 'disabled' : 'live',
    'features.shell_tool': true,
    'features.multi_agent': false, 'features.apps': false,
    'features.hooks': false, 'features.plugins': false,
  };
  if (config.provider !== 'openai') {
    const prefix = `model_providers.${config.provider}`;
    Object.assign(settings, { [`${prefix}.name`]: config.provider, [`${prefix}.base_url`]: config.base_url,
      [`${prefix}.wire_api`]: 'responses', [`${prefix}.env_key`]: config.api_key_env });
  }
  for (const [key, value] of Object.entries(settings)) args.push('-c', `${key}=${JSON.stringify(value)}`);
  args.push('-');
  return args;
}

// No shell interpolation or inherited user config, MCP servers or plugins.
// A separate home/work directory avoids inherited state; it is not a filesystem
// boundary. Model-requested commands run with full filesystem/network access.
async function execute(config, payload, { sanitized = false, signal } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-cloud-'));
  try {
    const home = path.join(directory, 'codex');
    await fs.mkdir(home, { mode: 0o700 });
    const env = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
    env.CODEX_HOME = home;
    env.HOME = directory;
    env.USERPROFILE = directory;
    if (config.provider === 'openai') {
      if (config.api_key || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) env.CODEX_API_KEY = config.api_key || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
      else {
        const source = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
        try { await fs.copyFile(source, path.join(home, 'auth.json')); await fs.chmod(path.join(home, 'auth.json'), 0o600); }
        catch { throw new CloudError('cloud_auth_required', 'Run codex login with file-based credentials, or provide CODEX_API_KEY to the MCP process.'); }
      }
    } else {
      const key = config.api_key || process.env[config.api_key_env];
      if (!key) throw new CloudError('cloud_auth_required', 'Open cloud settings and save an API key.');
      // Map credentials to a dedicated variable so reserved process variables cannot be overridden.
      env.PRIVACY_CLOUD_API_KEY = key;
    }
    const execConfig = config.provider === 'openai' ? config : { ...config, api_key_env: 'PRIVACY_CLOUD_API_KEY' };
    if (signal.aborted) throw new CloudError('cloud_exec_cancelled', 'The MCP service is stopping.');
    return await new Promise((resolve, reject) => {
      const child = spawn(process.env.PRIVACY_ROUTER_CODEX_BIN || 'codex', execArguments(execConfig, directory, { sanitized }), { cwd: directory, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let stdout = '', bytes = 0, failure;
      const stop = (code, message) => {
        failure ||= new CloudError(code, message);
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
      };
      const timer = setTimeout(() => stop('cloud_exec_timeout', 'Cloud analysis timed out. No automatic retry was started.'), config.timeout_ms);
      const abort = () => stop('cloud_exec_cancelled', 'The MCP service stopped this cloud process.');
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > MAX_OUTPUT_BYTES) stop('cloud_output_too_large', 'Cloud output exceeded the size limit.'); else stdout += chunk; });
      // Never return CLI diagnostics: they may contain credentials, prompts or provider responses.
      child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT_BYTES) stop('cloud_output_too_large', 'Cloud output exceeded the size limit.'); });
      child.stdin.on('error', () => { /* close/error determines the result */ });
      child.on('error', () => { failure ||= new CloudError('cloud_exec_unavailable', 'Cannot start codex. Check PRIVACY_ROUTER_CODEX_BIN and CLI installation.'); });
      child.on('close', code => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0) reject(new CloudError('cloud_exec_failed', 'codex exec failed. Check CLI compatibility, provider, model and authentication.'));
        else if (!stdout.trim()) reject(new CloudError('cloud_exec_empty', 'codex exec returned no analysis.'));
        else resolve(stdout.trim());
      });
      child.stdin.end(JSON.stringify(payload));
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
