// Settings are discovered by the desktop client without opening a conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CloudError, configPath, configRevision, loadCloudConfig, saveCloudConfig, publicCloudConfig, retainCloudCredential, sameCloudDestination } from './cloud-config.mjs';

export const settingsCapability = { readTool: 'cloud_settings_read', updateTool: 'cloud_settings_update' };
export const settingsLanguage = () => Intl.DateTimeFormat().resolvedOptions().locale || 'en';
const tr = (language, zh, en) => /^zh(?:-|$)/i.test(language) ? zh : en;
const draftPath = () => `${configPath()}.draft.json`;
const defaults = { provider_type: 'OpenAI / ChatGPT', provider_id: 'custom-cloud', model: '', base_url: '', api_key_env: '', timeout_seconds: 180 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = config => configRevision(config);

function fromConfig(config) {
  return config ? { provider_type: config.provider === 'openai' ? 'OpenAI / ChatGPT' : 'Custom',
    provider_id: config.provider === 'openai' ? defaults.provider_id : config.provider, model: config.model,
    base_url: config.base_url, api_key_env: config.api_key_env, timeout_seconds: config.timeout_ms / 1000 } : { ...defaults };
}
function toConfig(values) {
  const custom = values.provider_type === 'Custom';
  return { provider: custom ? values.provider_id.trim() : 'openai', model: values.model.trim(),
    base_url: custom ? values.base_url.trim() : '',
    timeout_ms: Math.round(values.timeout_seconds * 1000) };
}
function validatePatch(set) {
  if (!object(set) || !Object.keys(set).length || Object.keys(set).some(key => !Object.hasOwn(defaults, key))) {
    throw new CloudError('invalid_settings_patch', 'Update only the displayed settings fields.');
  }
  for (const [key, value] of Object.entries(set)) {
    const valid = key === 'timeout_seconds'
      ? typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 600 && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7
      : typeof value === 'string' && value.length <= ({ model: 200, provider_id: 64, api_key_env: 128 }[key] || 2048) && !/[\x00-\x1f\x7f]/.test(value);
    if (!valid || (key === 'provider_type' && !['OpenAI / ChatGPT', 'Custom'].includes(value))
        || (key === 'api_key_env' && value && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value))) {
      throw new CloudError('invalid_settings_patch', 'Check the field format. Use the password field in Open settings to enter an API key.');
    }
  }
}
function snapshot() {
  const active = loadCloudConfig();
  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath(), 'utf8'));
    if (!object(draft) || draft.version !== 1 || typeof draft.base_revision !== 'string'
        || !object(draft.values) || Object.keys(defaults).some(key => !Object.hasOwn(draft.values, key))) throw new Error();
    validatePatch(draft.values);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new CloudError('cloud_draft_unreadable', 'Cannot read the settings draft. Discard the draft and try again.');
  }
  return { active, draft, values: draft?.values || fromConfig(active),
    conflict: Boolean(draft && draft.base_revision !== revision(active)) };
}
function writeDraft(value) {
  const filename = draftPath(), temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } catch { throw new CloudError('cloud_config_write_failed', 'Cannot save the local settings draft.'); }
  finally { fs.rmSync(temporary, { force: true }); }
}
// The detail page and MCP App may be served by different MCP processes.
// Serialize their short read/modify/write transactions; never hold this for inference.
function mutate(action) {
  const lock = `${configPath()}.settings.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw new CloudError('cloud_config_write_failed', 'Cannot write cloud settings.');
    // Recover a lock left by a terminated process; live owners are never evicted.
    try {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') fs.rmSync(lock, { force: true }); }
      } else if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.rmSync(lock, { force: true });
    } catch { /* Another process may have released the lock. Retry once below. */ }
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch { throw new CloudError('cloud_settings_busy', 'Settings are being saved in another window. Please try again.'); }
  }
  try { fs.writeFileSync(fd, String(process.pid)); return action(); }
  finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
}

export function readCloudSettings(language = settingsLanguage()) {
  const { active, draft, values, conflict } = snapshot();
  const custom = values.provider_type === 'Custom';
  const text = (zh, en) => tr(language, zh, en);
  // Native action buttons show a result but do not refetch the form. Use an
  // instruction for drafts, not a pending-state claim that goes stale on apply.
  const status = conflict ? text('配置已在其他页面更新，请打开完整设置', 'Settings changed elsewhere — open settings to reload')
    : draft ? text('填写完成后请应用配置', 'Apply settings when finished editing')
    : active ? text('已配置', 'Configured') : text('尚未配置 · 填写后点击应用配置', 'Not configured — fill in and apply');
  const current = active ? `${active.provider} / ${active.model}` : text('尚未设置', 'Not set');
  const properties = {
    provider_type: { type: 'string', title: text('供应商', 'Provider'), enum: ['OpenAI / ChatGPT', 'Custom'],
      description: (draft ? '' : text(`当前生效：${current}。`, `Active: ${current}. `)) + text('填写内容自动保存为草稿；应用后用于后续云端任务。', 'Edits are saved as a draft; apply them for future cloud tasks.') },
    ...(custom ? {
      provider_id: { type: 'string', title: text('供应商 ID', 'Provider ID'), maxLength: 64,
        description: text('为连接取一个名称，例如 company-cloud；使用字母、数字、下划线或连字符。', 'Name this connection, for example company-cloud. Use letters, digits, underscores or hyphens.') },
      base_url: { type: 'string', title: text('接口地址', 'Base URL'), maxLength: 2048,
        description: text('填写 HTTPS 地址，例如 https://gateway.example/v1。服务须兼容 Responses API。', 'Use HTTPS, for example https://gateway.example/v1. The service must support the Responses API.') },
    } : {}),
    model: { type: 'string', title: text('模型 ID', 'Model ID'), maxLength: 200,
      description: custom ? text('填写该供应商和账号实际可用的完整模型 ID。', 'Enter the exact model ID available to this provider and account.')
        : text('填写账号可用的模型 ID。可在完整设置中直接填写 API Key，也可使用 Codex 登录凭据。', 'Enter an available model ID. Enter an API key in Open settings or use Codex login credentials.') },
    timeout_seconds: { type: 'number', title: text('超时时间（秒）', 'Timeout (seconds)'), minimum: 1, maximum: 600, multipleOf: 0.001,
      description: text('默认 180 秒。应用配置只在本机保存，不发送推理请求。', 'Default: 180 seconds. Applying settings saves locally and sends no inference request.') },
  };
  return { schema: { type: 'object', properties }, values: Object.fromEntries(Object.keys(properties).map(key => [key, values[key]])),
    layout: [{ kind: 'group', title: text('云端模型 · ', 'Cloud model · ') + status,
      items: Object.keys(properties).map(property => ({ kind: 'property', property })) },
    { kind: 'group', title: text('应用与管理', 'Apply and manage'), items: [
      { kind: 'tool', tool: 'cloud_settings_apply', description: text('校验并启用这份配置。不会发送推理请求。', 'Validate and activate these settings without sending an inference request.') },
      { kind: 'tool', tool: 'open_cloud_settings', description: (active?.api_key && sameCloudDestination(toConfig(values), active) ? text('API Key 已保存。', 'API key saved. ') : '') + text('直接填写或更换 API Key、应用配置或撤销草稿。', 'Enter or replace an API key, apply settings or discard a draft.') },
    ] }], configured: Boolean(active), has_draft: Boolean(draft), conflict };
}

export function updateCloudSettings(set, language) {
  validatePatch(set);
  return mutate(() => {
    const state = snapshot();
    if (state.conflict) throw new CloudError('cloud_settings_conflict', 'Settings changed elsewhere. Discard this draft before editing again.');
    writeDraft({ version: 1, base_revision: revision(state.active), values: { ...state.values, ...set } });
    return readCloudSettings(language);
  });
}
function validateForApply(values, language) {
  const text = (zh, en) => tr(language, zh, en);
  if (!values.model.trim()) throw new CloudError('cloud_model_required', text('请填写模型 ID，再应用配置。', 'Enter a model ID before applying settings.'));
  if (values.provider_type === 'Custom') {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(values.provider_id.trim()) || ['openai', 'ollama', 'lmstudio', 'amazon-bedrock'].includes(values.provider_id.trim())) {
      throw new CloudError('cloud_provider_invalid', text('请填写有效的自定义供应商 ID，且不要使用 openai 等保留名称。', 'Enter a valid custom provider ID; names such as openai are reserved.'));
    }
    let url;
    try { url = new URL(values.base_url.trim()); } catch { /* Report a field-specific error below. */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new CloudError('cloud_url_invalid', text('请填写 HTTPS 接口地址，不要在地址中放入密钥、查询参数或片段。', 'Enter an HTTPS base URL without credentials, query parameters or fragments.'));
    }
  }
}
export function applyCloudSettings(language = settingsLanguage()) {
  return mutate(() => {
    const state = snapshot();
    if (state.conflict) throw new CloudError('cloud_settings_conflict', tr(language, '配置已在其他页面更新。请先撤销草稿，再重新填写。', 'Settings changed elsewhere. Discard this draft and edit again.'));
    validateForApply(state.values, language);
    const config = retainCloudCredential(toConfig(state.values), state.active);
    if (config.provider !== 'openai' && !config.api_key && !config.api_key_env) {
      throw new CloudError('cloud_key_required', tr(language, '请点击“打开完整设置”，直接填写 API Key 并应用配置。', 'Choose Open settings, enter an API key and apply settings.'));
    }
    saveCloudConfig(config);
    fs.rmSync(draftPath(), { force: true });
    return { ...readCloudSettings(language), message: tr(language, '配置已应用，下次云端分析将使用此配置。模型和鉴权会在首次任务时验证。', 'Settings applied for future cloud tasks. Model access and authentication are checked on the first task.') };
  });
}
export function resetCloudSettings(language = settingsLanguage()) {
  return mutate(() => {
    fs.rmSync(draftPath(), { force: true });
    return { ...readCloudSettings(language), message: tr(language, '已撤销草稿，当前生效配置保持不变。', 'Draft discarded. The active settings are unchanged.') };
  });
}
export function cloudSettingsPage() {
  const state = snapshot();
  const config = state.draft ? toConfig(state.values) : state.active;
  return { cloud_settings: true, configured: Boolean(state.active), has_draft: Boolean(state.draft), conflict: state.conflict,
    config: publicCloudConfig(config), active_config: publicCloudConfig(state.active), config_revision: revision(state.active),
    api_key_saved: Boolean(state.active?.api_key), legacy_credential: Boolean(state.active?.api_key_env) };
}
export function saveCloudSettingsPage(config, expectedRevision) {
  return mutate(() => {
    if (expectedRevision !== undefined && expectedRevision !== revision(loadCloudConfig())) {
      throw new CloudError('cloud_settings_conflict', 'Settings changed elsewhere. Reload before saving.');
    }
    saveCloudConfig(retainCloudCredential(config, loadCloudConfig()));
    fs.rmSync(draftPath(), { force: true });
    return cloudSettingsPage();
  });
}
