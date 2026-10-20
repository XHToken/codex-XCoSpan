import { translate } from '../../shared/messages.mjs';
import { App } from '@modelcontextprotocol/ext-apps';

const $ = (selector) => document.querySelector(selector);
const state = { data: {}, ready: false, busy: false, dirty: false, editing: false, hydrated: false, notifying: false, hostMode: null, popup: false, sdkReady: false, inferredExpanded: false, closed: false, closing: false, presentationEpoch: 0 };
const t = (source) => translate(source, state.data.response_language || 'en', state.data.ui_translations);
const labels = () => ({ principal: t('主体'), person: t('人员'), address: t('地址'), bank: t('银行'), account: t('账号'), tax_id: t('税号'), id_number: t('证件'), number: t('编号'), email: t('邮箱'), phone: t('电话'), amount: t('金额') });
const categoryOrder = Object.keys(labels());
const app = new App({ name: 'Redaction review', version: __PLUGIN_VERSION__ }, {}, { autoResize: false });
const requestOptions = { timeout: 20000 };
function applyLanguage() {
  document.documentElement.lang = state.data.response_language || 'en';
  document.documentElement.dir = /^(ar|fa|he|ur)(-|$)/i.test(document.documentElement.lang) ? 'rtl' : 'ltr';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel));
}

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function parse(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
}
function decode(value, metadata = {}) {
  const result = parse(value);
  const meta = parse(metadata);
  const metadataResult = parse(meta.mcp_tool_result ?? meta.call_tool_result);
  const nested = parse(result.result ?? result.mcp_tool_result ?? result.call_tool_result ?? result);
  const text = nested.content?.find((item) => item.type === 'text')?.text;
  const data = parse(nested.structuredContent ?? text ?? metadataResult.structuredContent ?? nested);
  const redaction = parse(nested._meta?.redaction ?? result._meta?.redaction ?? metadataResult._meta?.redaction ?? meta.redaction);
  // Only merge widget metadata for the same review. Originals never go into a
  // message, model context, persistent widget state, or browser storage.
  return (!redaction.review_id || !data.review_id || redaction.review_id === data.review_id) ? { ...data, ...redaction } : data;
}
function status(text, kind = '') {
  const element = $('#status');
  element.textContent = text;
  element.className = `status ${kind}`;
}
function controls() {
  const loaded = Boolean(state.data.review_id && has(state.data, 'sanitized_content'));
  const stopped = ['rejected', 'revoked', 'running', 'completed', 'failed'].includes(state.data.status);
  const confirmed = state.data.status === 'confirmed';
  $('#open-review').disabled = !loaded;
  $('#confirm').disabled = !loaded || !state.ready || state.busy || state.dirty || stopped || confirmed || !has(state.data, 'original_content');
  $('#confirm').textContent = state.busy ? t('正在处理…') : confirmed ? t('已确认') : t('确认并继续');
  $('#reject').disabled = !loaded || !state.ready || state.busy || stopped;
  $('#repreview').hidden = !state.dirty;
  $('#repreview').disabled = !loaded || !state.ready || state.busy || stopped || confirmed;
  $('#edit').disabled = !loaded || state.busy || stopped || confirmed;
  $('#continue').disabled = state.busy || state.notifying;
  $('#sanitized').readOnly = true;
}
function summary(data) {
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const counts = new Map();
  for (const change of changes) counts.set(change.type, (counts.get(change.type) || 0) + 1);
  const categories = Array.isArray(data.change_summary?.categories) ? data.change_summary.categories : [...counts].map(([type, count]) => ({ type, count, label: labels()[type] || t('其他') }));
  const total = data.change_summary?.total ?? data.change_count ?? data.sensitive_count ?? (has(data, 'changes') ? changes.length : null);
  for (const element of document.querySelectorAll('[data-count]')) element.textContent = total === null ? '—' : String(total);
  for (const element of document.querySelectorAll('[data-summary-title]')) element.textContent = total === null ? t('等待脱敏扫描') : total === 0 ? t('当前版本未记录替换；仍需核对内容') : t('项敏感信息已替换');
  for (const element of document.querySelectorAll('[data-chips]')) {
    element.replaceChildren();
    if (total === null) { element.textContent = t('替换统计尚未到达，请稍候。'); continue; }
    if (total === 0) { element.textContent = t('替换数量不代表不存在敏感信息，请核对全文。'); continue; }
    const rank = (type) => categoryOrder.includes(type) ? categoryOrder.indexOf(type) : categoryOrder.length;
    for (const item of [...categories].sort((a, b) => rank(a.type) - rank(b.type))) {
      const chip = document.createElement('span'); chip.className = 'chip';
      const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓';
      const label = document.createElement('span'); label.textContent = labels()[item.type] || t('其他');
      const count = document.createElement('b'); count.textContent = String(item.count);
      chip.append(check, label, count); element.append(chip);
    }
    if (data.content_retention?.passage_selections) { const warning = document.createElement('span'); warning.textContent = t('本版本包含整段替换，请确认剩余内容足以完成原任务。'); element.append(warning); }
    if (!categories.length) element.textContent = t('类别明细尚未到达，请重新查看预览。');
  }
}
function highlight(element, content, ranges) {
  const fragment = document.createDocumentFragment(); let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < cursor || range.end > content.length || range.end <= range.start) continue;
    fragment.append(document.createTextNode(content.slice(cursor, range.start)));
    const mark = document.createElement('mark'); mark.textContent = content.slice(range.start, range.end);
    fragment.append(mark); cursor = range.end;
  }
  fragment.append(document.createTextNode(content.slice(cursor))); element.replaceChildren(fragment);
}
function render(data) {
  if (data.ok === false) { showError(data.error, data.validation); return; }
  if (data.cloud_settings) { renderCloudSettings(data); return; }
  if (!data.review_id) return;
  if (state.data.review_id && data.review_id !== state.data.review_id) {
    state.data = {}; void closeReview(); state.dirty = false; state.editing = false; state.hydrated = false;
  }
  state.data = { ...state.data, ...data };
  applyLanguage();
  if (has(data, 'sanitized_content') && !state.dirty) $('#sanitized').value = data.sanitized_content;
  const current = state.data;
  if (has(current, 'original_content')) highlight($('#original'), current.original_content || '', current.original_changes ?? current.changes ?? []);
  else $('#original').textContent = t('原文尚未到达，正在读取本机预览…');
  if (has(current, 'sanitized_content')) highlight($('#sanitized-preview'), current.sanitized_content, (current.changes || []).map((change) => ({ start: change.sanitized_start, end: change.sanitized_end })));
  summary(current);
  $('#sanitized').hidden = !state.editing; $('#sanitized-preview').hidden = state.editing;
  $('#edit').textContent = state.editing ? t('查看高亮') : t('选择脱敏内容');
  if (current.status === 'confirmed') status(t('已确认脱敏版本，等待主会话继续交接。'), 'success');
  else if (current.status === 'rejected') status(t('已拒绝，交接已停止。'));
  else if (current.status === 'revoked') status(t('授权已撤销，交接已停止。'));
  else if (['running', 'completed', 'failed'].includes(current.status)) status(t('云端任务已提交，请在主会话查看结果。'), 'success');
  else if (state.dirty) status(t('内容已编辑，请重新扫描后确认。'));
  else status(t('请查看脱敏对照，再确认继续。'));
  controls();
  syncPresentation();
  if (!has(current, 'original_content') && state.ready && !state.hydrated) void hydrate();
}
function showError(error, validation) {
  const messages = {
    review_not_found: t('预览已过期或服务已重启，请在主会话重新生成脱敏预览。'),
    sensitive_value_detected: t('编辑内容中仍有敏感信息，请删除或替换后重新扫描。'),
    content_too_large: t('内容过长，请分块生成预览。'),
    audience_denied: t('当前会话无法读取此预览，请回到主会话操作。'),
    unregistered_placeholder: t('替换标记未登记，请使用选中脱敏或在主会话修正替换范围。'),
    structured_redaction_required: t('为保留原文条款，请选中文字进行脱敏，不要改写或删除正文。'),
    span_scope_required: t('所选范围跨越多段，请缩小范围；确需整段脱敏可在主会话说明。'),
    invalid_sensitive_spans: t('脱敏范围无效，请重新选择。'),
    version_mismatch: t('预览已更新，请重新读取后操作。'),
    version_required: t('预览已更新，请重新读取后操作。'),
  };
  status(messages[error?.code] || t('操作失败，请重试；若仍失败，请在主会话继续。'), 'error');
  const issue = validation?.issues?.find((item) => Number.isInteger(item.start) && Number.isInteger(item.end));
  if (issue && has(state.data, 'sanitized_content') && validation.stage !== 'selection') {
    state.editing = true; $('#sanitized').hidden = false; $('#sanitized-preview').hidden = true;
    $('#sanitized').focus(); $('#sanitized').setSelectionRange(issue.start, issue.end);
  }
}
async function callTool(name, args) {
  if (state.ready && !window.openai?.callTool) return app.callServerTool({ name, arguments: args }, requestOptions);
  if (typeof window.openai?.callTool === 'function') return withTimeout(window.openai.callTool(name, args));
  throw new Error('bridge_unavailable');
}
function withTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 20000);
    Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
function cloudProviderMode() {
  const custom = $('#cloud-provider-mode').value === 'custom';
  $('#cloud-custom').hidden = !custom;
  $('#cloud-openai-hint').hidden = custom;
  for (const id of ['cloud-provider', 'cloud-base-url']) { $('#' + id).required = custom; $('#' + id).disabled = !custom; }
  cloudCredentialHint();
  scheduleHeight();
}
let cloudRevision, cloudConflict = false, cloudSaving = false, cloudCredential;
function cloudCredentialHint() {
  const custom = $('#cloud-provider-mode').value === 'custom';
  const provider = custom ? $('#cloud-provider').value.trim() : 'openai';
  const base = custom ? $('#cloud-base-url').value.trim().replace(/\/+$/, '') : '';
  const retained = cloudCredential && provider === cloudCredential.provider && base === cloudCredential.base_url;
  $('#cloud-api-key').required = custom && !retained;
  $('#cloud-api-key').placeholder = retained ? t('已保存；留空保持不变') : t('粘贴 API Key');
  $('#cloud-key-hint').textContent = retained
    ? t('已保存凭据。留空继续使用，填写新 Key 后应用即可更换。')
    : t('直接填写 Key，应用后保存在本机受限权限的配置文件中，不回显密钥。');
}
function cloudStatus(message, kind = '') {
  $('#cloud-status').textContent = message;
  $('#cloud-status').className = `status ${kind}`;
  scheduleHeight();
}
function renderCloudSettings(data) {
  if (data.response_language && !state.data.review_id) { state.data.response_language = data.response_language; applyLanguage(); }
  const config = data.config || {};
  $('#cloud-provider-mode').value = config.provider && config.provider !== 'openai' ? 'custom' : 'openai';
  $('#cloud-provider').value = config.provider === 'openai' ? 'custom-cloud' : config.provider || 'custom-cloud';
  $('#cloud-base-url').value = config.base_url || '';
  $('#cloud-api-key').value = '';
  cloudCredential = (data.api_key_saved || data.legacy_credential) && data.active_config
    ? { provider: data.active_config.provider, base_url: (data.active_config.base_url || '').replace(/\/+$/, '') } : null;
  $('#cloud-model').value = config.model || '';
  $('#cloud-timeout').value = (config.timeout_ms || 180000) / 1000;
  cloudRevision = data.config_revision;
  cloudConflict = Boolean(data.conflict);
  const active = data.active_config || (data.configured && !data.has_draft ? config : null);
  $('#cloud-current').textContent = active ? `${t('当前生效：')}${active.provider} / ${active.model}` : t('尚未配置云端模型。填写后点击“应用配置”即可完成。');
  $('#cloud-save').disabled = cloudConflict;
  $('#cloud-settings').hidden = false;
  $('#close-cloud-settings').hidden = !state.data.review_id;
  document.body.classList.add('cloud-settings-open');
  state.popup = false; syncPresentation();
  cloudProviderMode();
  cloudStatus(cloudConflict ? t('配置已在其他页面更新，请撤销更改后重新填写。') : data.has_draft ? t('已恢复未应用的草稿。点击“应用配置”后生效。') : data.configured ? t('已读取本机保存的云端配置。') : t('请先保存供应商和模型。'), cloudConflict ? 'error' : '');
}
async function loadCloudSettings(discard = false) {
  if (cloudSaving) return;
  cloudSaving = true;
  $('#cloud-fields').disabled = true; $('#cloud-save').disabled = true; $('#cloud-reload').disabled = true;
  cloudStatus(t('正在读取云端配置…'));
  try {
    if (discard) {
      const reset = decode(await callTool('cloud_settings_reset', { response_language: state.data.response_language || 'en' }));
      if (reset.ok === false) throw new Error(reset.error?.code);
    }
    const data = decode(await callTool('open_cloud_settings', { response_language: state.data.response_language || 'en' }));
    if (data.ok === false) throw new Error(data.error?.code);
    renderCloudSettings(data);
  } catch { cloudStatus(t('无法读取配置，请检查本机配置文件或连接后重试。'), 'error'); }
  finally { cloudSaving = false; $('#cloud-fields').disabled = false; $('#cloud-save').disabled = cloudConflict; $('#cloud-reload').disabled = false; }
}
$('#cloud-provider-mode').addEventListener('change', cloudProviderMode);
$('#open-cloud-settings').addEventListener('click', () => void loadCloudSettings());
$('#close-cloud-settings').addEventListener('click', () => { $('#cloud-settings').hidden = true; document.body.classList.remove('cloud-settings-open'); syncPresentation(); });
$('#cloud-reload').addEventListener('click', () => void loadCloudSettings(true));
$('#cloud-form').addEventListener('input', () => { cloudCredentialHint(); if (!cloudConflict) cloudStatus(t('更改尚未应用。点击“应用配置”后生效。')); });
$('#cloud-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (cloudSaving || cloudConflict) return;
  const custom = $('#cloud-provider-mode').value === 'custom';
  const config = { provider: custom ? $('#cloud-provider').value.trim() : 'openai', model: $('#cloud-model').value.trim(),
    base_url: custom ? $('#cloud-base-url').value.trim() : '', api_key: $('#cloud-api-key').value.trim(), timeout_ms: Math.round(Number($('#cloud-timeout').value) * 1000) };
  if (custom) {
    let url;
    try { url = new URL(config.base_url); } catch { /* Report below. */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      cloudStatus(t('请填写不含密钥、查询参数或片段的 HTTPS 接口地址。'), 'error'); $('#cloud-base-url').focus(); return;
    }
  }
  cloudSaving = true;
  $('#cloud-fields').disabled = true; $('#cloud-save').disabled = true; $('#cloud-reload').disabled = true; $('#close-cloud-settings').disabled = true;
  cloudStatus(t('正在应用配置…'));
  try {
    const data = decode(await callTool('save_cloud_settings', { config, expected_revision: cloudRevision, response_language: state.data.response_language || 'en' }));
    if (data.ok === false) throw new Error(data.error?.code);
    renderCloudSettings(data); cloudStatus(t('云端配置已保存，下次分析将使用此供应商和模型。'), 'success');
  } catch (error) {
    if (error.message === 'cloud_settings_conflict') cloudConflict = true;
    cloudStatus(cloudConflict ? t('配置已在其他页面更新，请撤销更改后重新填写。') : t('保存失败，请检查供应商、模型、HTTPS 地址、API Key 和超时时间。'), 'error');
  }
  finally { cloudSaving = false; $('#cloud-fields').disabled = false; $('#cloud-save').disabled = cloudConflict; $('#cloud-reload').disabled = false; $('#close-cloud-settings').disabled = false; scheduleHeight(); }
});
async function hydrate() {
  state.hydrated = true;
  try { render(decode(await callTool('preview_redaction', { review_id: state.data.review_id, audience: 'main' }))); }
  catch { status(t('无法读取本机原文，请重新生成预览。'), 'error'); }
}
function isExpanded() {
  // A host's explicit inline mode wins over any old fullscreen dimensions.
  if (!$('#cloud-settings').hidden || state.closed || state.hostMode === 'inline') return false;
  if (['fullscreen', 'pip'].includes(state.hostMode)) return true;
  return state.inferredExpanded;
}
function applyHostMode(mode, { initialize = false } = {}) {
  if (!['inline', 'fullscreen', 'pip'].includes(mode)) return;
  if (mode !== 'inline' && state.closing) return;
  const changed = state.hostMode !== mode;
  const returningInline = mode === 'inline' && (changed || state.inferredExpanded || state.closing);
  state.hostMode = mode;
  state.inferredExpanded = false;
  if (mode === 'inline') {
    // Reparenting back to the conversation must clear the local popup too.
    // Startup may finish after a user has opened a local fallback comparison.
    if (!initialize && returningInline) {
      state.presentationEpoch += 1;
      state.popup = false;
      state.closed = true;
      state.closing = false;
    }
  } else {
    state.presentationEpoch += 1;
    state.popup = false;
    state.closed = false;
  }
  if (changed) lastReportedHeight = null;
  syncPresentation();
}
let previousViewport = { width: window.innerWidth, height: window.innerHeight };
function viewportChanged() {
  const next = { width: window.innerWidth, height: window.innerHeight };
  // Compatibility fallback only for hosts with NO display mode. Merely being
  // tall cannot distinguish a side panel from an inline frame being returned.
  if (state.hostMode === null && !state.closed) {
    if (next.width <= previousViewport.width - 120 && next.height >= previousViewport.height + 120) state.inferredExpanded = true;
    else if (next.width >= previousViewport.width + 120 || next.height <= previousViewport.height - 120) state.inferredExpanded = false;
  }
  previousViewport = next;
  syncPresentation();
}
function syncPresentation() {
  const expanded = isExpanded();
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('review-open', !expanded && state.popup);
  $('#review-backdrop').hidden = expanded || !state.popup;
  if (expanded || state.popup) {
    if (!$('#review').open) $('#review').show();
  } else if ($('#review').open) $('#review').close();
  scheduleHeight();
}
let heightFrame = null;
let lastReportedHeight = null;
function scheduleHeight() {
  if (heightFrame !== null) return;
  heightFrame = requestAnimationFrame(() => {
    heightFrame = null;
    const footerHeight = Math.ceil($('#bottom-bar').getBoundingClientRect().height);
    document.documentElement.style.setProperty('--footer-height', `${footerHeight}px`);
    // Measure actual content in inline mode rather than the host's current
    // viewport/scrollHeight, which would preserve a previously oversized iframe.
    const height = isExpanded() || state.popup ? window.innerHeight : footerHeight;
    if (height === lastReportedHeight) return;
    lastReportedHeight = height;
    try {
      if (typeof window.openai?.notifyIntrinsicHeight === 'function') {
        Promise.resolve(window.openai.notifyIntrinsicHeight(height)).catch(() => {});
      } else if (state.sdkReady) {
        void app.sendSizeChanged({ height }).catch(() => {});
      }
    } catch { /* Layout still renders correctly if a host rejects resizing. */ }
  });
}
async function openReview() {
  const epoch = ++state.presentationEpoch;
  state.popup = true; state.closed = false; state.closing = false;
  syncPresentation(); $('#close-review').focus();
  if (state.ready) {
    try {
      let result;
      if (window.openai?.requestDisplayMode) result = await withTimeout(window.openai.requestDisplayMode({ mode: 'fullscreen' }));
      else if (state.sdkReady && app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) result = await app.requestDisplayMode({ mode: 'fullscreen' }, requestOptions);
      // A delayed open response must not reopen a view that was already closed.
      if (epoch !== state.presentationEpoch) return;
      if (['fullscreen', 'pip'].includes(result?.mode)) applyHostMode(result.mode);
      else if (result?.mode === 'inline') { state.hostMode = 'inline'; syncPresentation(); }
    } catch { /* Keep the local comparison visible when expansion is declined. */ }
  }
}
async function closeReview() {
  const epoch = ++state.presentationEpoch;
  state.popup = false; state.closed = true; state.closing = true;
  state.inferredExpanded = false; state.hostMode = 'inline';
  lastReportedHeight = null;
  // Collapse and report the compact height before awaiting any host reply.
  syncPresentation(); $('#open-review').focus({ preventScroll: true });
  try {
    if (window.openai?.requestDisplayMode) await withTimeout(window.openai.requestDisplayMode({ mode: 'inline' }));
    else if (state.sdkReady && app.getHostContext()?.displayMode === 'fullscreen') await app.requestDisplayMode({ mode: 'inline' }, requestOptions);
  } catch { /* Closing never changes the review, edits, or authorization. */ }
  finally { if (epoch === state.presentationEpoch) state.closing = false; }
}
async function notifyMain() {
  if (state.notifying) return;
  state.notifying = true; controls();
  status(t('已确认，正在通知主会话继续…'), 'success');
  // Keep routing details out of the chat bubble when the host supports model
  // context. This reference is a continuation signal, not proof of consent.
  const context = { review_id: state.data.review_id, action: 'continue_confirmed_redaction' };
  let contextSaved = false;
  try {
    let result;
    if (state.sdkReady && app.getHostCapabilities()?.updateModelContext?.structuredContent) {
      result = await app.updateModelContext({ structuredContent: context }, requestOptions);
    } else if (typeof window.openai?.setWidgetState === 'function') {
      result = await withTimeout(Promise.resolve(window.openai.setWidgetState({ modelContent: context, privateContent: null })));
    } else throw new Error('context_unavailable');
    contextSaved = result?.isError !== true;
  } catch { /* Older hosts retain the review reference in the short message. */ }
  const prompt = t('已确认脱敏内容，请使用云端模型继续分析。') + (contextSaved ? '' : ' ' + t('（预览编号：{review_id}）').replace('{review_id}', state.data.review_id));
  try {
    let result;
    if (window.openai?.sendFollowUpMessage) result = await withTimeout(window.openai.sendFollowUpMessage({ prompt }));
    else if (state.ready && app.getHostCapabilities()?.message) result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] }, requestOptions);
    else throw new Error('message_unavailable');
    if (result?.isError) throw new Error('message_rejected');
    $('#continue').hidden = true;
    status(t('已确认，已通知主会话调用云端模型。'), 'success');
  } catch {
    $('#continue').hidden = false;
    status(t('确认已保存，但未能通知主会话。可重试，或在主会话输入“继续已确认的脱敏任务”。'), 'error');
  } finally { state.notifying = false; controls(); }
}
async function action(name, args, confirmed = false) {
  if (state.busy || state.notifying) return;
  state.busy = true; controls(); status(name === 'preview_redaction' ? t('正在扫描编辑内容…') : t('正在保存选择…'));
  try {
    const data = decode(await callTool(name, { review_id: state.data.review_id, audience: 'main', expected_sanitized_sha256: state.data.sanitized_sha256, ...args }));
    if (data.ok === false) { showError(data.error, data.validation); return; }
    if (!data.review_id || !data.status) throw new Error('invalid_result');
    state.dirty = false;
    if (has(data, 'sanitized_content')) state.editing = false;
    render(data);
    if (confirmed && data.status === 'confirmed') await notifyMain();
    else if (data.status === 'rejected') $('#continue').hidden = true;
  } catch { status(t('操作未完成：连接失败或请求超时。请重试或在主会话继续。'), 'error'); }
  finally { state.busy = false; controls(); }
}
$('#open-review').addEventListener('click', () => void openReview());
$('#close-review').addEventListener('click', () => void closeReview());
$('#review-backdrop').addEventListener('click', () => void closeReview());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#review').open) { event.preventDefault(); void closeReview(); $('#open-review').focus(); }
});
$('#edit').addEventListener('click', () => {
  state.editing = !state.editing; state.dirty = false; controls();
  $('#sanitized').hidden = !state.editing; $('#sanitized-preview').hidden = state.editing;
  $('#edit').textContent = state.editing ? t('查看高亮') : t('选择脱敏内容');
  if (state.editing) $('#sanitized').focus();
  else highlight($('#sanitized-preview'), $('#sanitized').value, (state.data.changes || []).map((change) => ({ start: change.sanitized_start, end: change.sanitized_end })));
    if (state.editing) status(t('请选中仍需脱敏的文字，再点击“脱敏选中内容”；相同内容会同步替换。'));
});
$('#sanitized').addEventListener('select', () => {
  if (!state.editing || state.busy) return;
  state.dirty = $('#sanitized').selectionEnd > $('#sanitized').selectionStart;
  controls();
});
$('#confirm').addEventListener('click', () => void action('confirm_redaction', { confirmed: true }, true));
$('#reject').addEventListener('click', () => void action('confirm_redaction', { confirmed: false }));
$('#repreview').addEventListener('click', () => {
  const { selectionStart: start, selectionEnd: end } = $('#sanitized');
  if (end > start) void action('preview_redaction', { redactions: [{ start, end, type: 'private_content' }] });
});
$('#continue').addEventListener('click', () => void notifyMain());
function openaiResult(globals = window.openai || {}, initialize = false) {
  const current = window.openai || {};
  if (has(globals, 'displayMode')) applyHostMode(globals.displayMode, { initialize });
  syncPresentation();
  if (typeof current.callTool === 'function') { state.ready = true; controls(); }
  // Display-only notifications must not replay an older awaiting-confirmation
  // snapshot over a consent result already saved by a UI action.
  if (['toolOutput', 'toolResult', 'toolResponseMetadata'].some((key) => has(globals, key))) {
    render(decode(globals.toolOutput ?? globals.toolResult ?? current.toolOutput ?? current.toolResult, globals.toolResponseMetadata ?? current.toolResponseMetadata));
  }
}
window.addEventListener('openai:set_globals', (event) => openaiResult(event.detail?.globals));
app.ontoolresult = (result) => render(decode(result));
app.onhostcontextchanged = (context) => {
  if (context.displayMode) applyHostMode(context.displayMode);
  else syncPresentation();
};
window.addEventListener('resize', viewportChanged);
app.ontoolcancelled = () => { status(t('预览生成已取消，请在主会话重新生成。'), 'error'); };
applyLanguage();
app.onerror = () => { /* Tool failures are surfaced by the action handler. */ };
openaiResult(window.openai || {}, true);
if (window.parent !== window) {
  app.connect(undefined, requestOptions).then(() => {
    state.ready = true; state.sdkReady = true; lastReportedHeight = null; controls();
    applyHostMode(app.getHostContext()?.displayMode, { initialize: true });
    syncPresentation();
    if (state.data.review_id && !has(state.data, 'original_content') && !state.hydrated) void hydrate();
  }).catch(() => { if (!state.ready) status(t('当前宿主未连接交互接口，请在主会话确认脱敏版本。'), 'error'); });
} else if (!window.openai?.callTool) {
  status(t('请在插件会话中打开此预览，以读取原文并确认。'));
}

// Observe real content heights, including wrapped actions and longer status text.
const footerObserver = new ResizeObserver(scheduleHeight);
footerObserver.observe($('#bottom-bar'));
syncPresentation();
