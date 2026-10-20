import { cloudFixture } from './helpers/cloud-fixture.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(root, 'ui/contract-redaction-review.html'), 'utf8');
// Synthetic fixture: no user attachments or private contracts enter this harness.
const original = '设备采购合同（演示数据）\n甲方：示例采购有限公司\n乙方：示例设备有限公司\n合同金额：人民币 1,850,000.00 元\n开户行：中国测试银行示例支行\n账号：6222 0202 0202 0202 020\n统一社会信用代码：91110000DEMO00000X\n地址：示例市演示路100号\n电话：0551-12345678\n邮箱：demo@example.com\n\n第一条 付款与交付\n待设备稳定运行30日，且收到乙方按甲方要求开具的发票后支付剩余款项。\n\n第二条 质保与违约\n设备质保期为12个月；发生故障时，应在24小时内响应。\n'.repeat(3);
function session() {
  const fixture = cloudFixture();
  const child = spawn(process.execPath, [path.join(root, 'mcp/server.mjs')], { env: fixture.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, buffer = ''; const pending = new Map();
  child.stdout.on('data', (chunk) => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const item = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); pending.get(item.id)?.(item.result); pending.delete(item.id); } });
  return { call(name, args) { if (name === 'create_redaction_review') args = { response_language: 'zh-CN', ...args }; const next = ++id; return new Promise((resolve) => { pending.set(next, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method: 'tools/call', params: { name, arguments: args } }) + '\n'); }); }, close() { child.kill(); child.once('exit', () => fixture.close()); } };
}
const launch = () => chromium.launch(process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : { channel: 'chrome' });
async function setupOpenAI(page, rpc, initial = {}) {
  const calls = [], messages = [], errors = [], widgetStates = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('testCall', async (name, args) => { calls.push({ name, args }); return rpc.call(name, args); });
  await page.exposeFunction('testMessage', (message) => { messages.push(message); });
  await page.exposeFunction('testWidgetState', (value) => { widgetStates.push(value); });
  await page.addInitScript((data) => {
    window.openai = { ...data, callTool: (name, args) => window.testCall(name, args), sendFollowUpMessage: (message) => window.testMessage(message), setWidgetState: (value) => window.testWidgetState(value), requestDisplayMode: async () => ({ mode: 'inline' }), notifyIntrinsicHeight: (height) => { window.reportedHeight = height; } };
  }, initial);
  await page.route('http://redaction.test/', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://redaction.test/');
  return { calls, messages, errors, widgetStates };
}
async function deliver(page, result) {
  await page.evaluate((data) => {
    const globals = { toolOutput: data.structuredContent, toolResponseMetadata: data._meta };
    Object.assign(window.openai, globals);
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals } }));
  }, result);
}

async function selectText(page, text) {
  await page.locator('#sanitized').evaluate((element, text) => {
    const start = element.value.indexOf(text);
    if (start < 0) throw new Error('Selection fixture missing');
    element.focus(); element.setSelectionRange(start, start + text.length);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  }, text);
}

test('late widget metadata shows a highlighted modal; click persists consent and resumes the main session', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 380 } });
    const observed = await setupOpenAI(page, rpc);
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    await deliver(page, result);
    if (await page.locator('#open-review').isVisible()) await page.locator('#open-review').click();
    await page.locator('#review[open]').waitFor();
    assert.equal(await page.locator('#original').textContent(), original);
    assert.equal(await page.locator('#original mark').count(), result.structuredContent.change_count);
    assert.equal(await page.locator('#sanitized-preview mark').count(), result.structuredContent.change_count);
    assert.equal(await page.locator('#bottom-bar [data-count]').textContent(), String(result.structuredContent.change_count));
    const positions = await page.locator('.panel').evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().toJSON()));
    assert.equal(positions[0].y, positions[1].y);
    assert.ok(positions[1].x > positions[0].x);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'redaction-modal.png') });
    }
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
    assert.equal(observed.calls.filter((item) => item.name === 'confirm_redaction').length, 1);
    assert.equal(observed.messages.length, 1);
    assert.equal(observed.messages[0].prompt, '已确认脱敏内容，请使用云端模型继续分析。');
    assert.deepEqual(observed.widgetStates, [{ modelContent: { review_id: result.structuredContent.review_id, action: 'continue_confirmed_redaction' }, privateContent: null }]);
    assert.ok(!observed.messages[0].prompt.includes(result.structuredContent.review_id));
    assert.doesNotMatch(observed.messages[0].prompt, /sha256|preview_redaction|run_cloud_analysis|audience|token/);
    assert.doesNotMatch(observed.messages[0].prompt, /示例采购有限公司|6222 0202|demo@example.com/);
    const recovered = await rpc.call('preview_redaction', { review_id: result.structuredContent.review_id, audience: 'main' });
    assert.equal(recovered.structuredContent.status, 'confirmed');
    const selected = await rpc.call('select_cloud_model', {});
    const handoff = await rpc.call('run_cloud_analysis', { review_id: recovered.structuredContent.review_id, handoff_token: recovered.structuredContent.handoff_token, expected_sanitized_sha256: recovered.structuredContent.sanitized_sha256, audience: 'main', model: 'gpt-6-astra', model_selection_id: selected.structuredContent.model_selection_id });
    assert.equal(handoff.structuredContent.status, 'running');
    assert.match(handoff.structuredContent.next_step, /get_cloud_result/);
    assert.equal(handoff.structuredContent.model, 'test-large');
    assert.ok(handoff.structuredContent.job_id);
    assert.equal(handoff.structuredContent.subagent_payload, undefined);
    await page.locator('#close-review').click();
    assert.equal(await page.locator('#review').isVisible(), false);
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.locator('#bottom-bar').screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'redaction-summary.png') });
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('edits require rescanning; errors and rejected consent never fake a successful upload', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    // Metadata is initially missing: the UI must recover it using preview_redaction.
    const observed = await setupOpenAI(page, rpc, { toolOutput: result.structuredContent });
    await page.waitForFunction(() => document.querySelector('#original').textContent.includes('设备采购合同'));
    assert.equal(observed.calls[0].name, 'preview_redaction');
    if (await page.locator('#open-review').isVisible()) await page.locator('#open-review').click();
    await page.locator('#edit').click();
    assert.equal(await page.locator('#sanitized').getAttribute('readonly'), '');
    await selectText(page, '30日');
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    await page.evaluate(() => { const originalCall = window.openai.callTool; window.restoreCall = originalCall; window.openai.callTool = async () => ({ structuredContent: { ok: false, error: { code: 'sensitive_value_detected' } } }); });
    await page.locator('#repreview').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('仍有敏感信息'));
    assert.equal(observed.messages.length, 0);
    await page.evaluate(() => { window.openai.callTool = window.restoreCall; });
    await page.locator('#repreview').click();
    await page.waitForFunction(() => !document.querySelector('#confirm').disabled);
    assert.equal(await page.locator('#bottom-bar [data-count]').textContent(), String(result.structuredContent.change_count + 3));
    assert.equal(await page.locator('#original mark').count(), result.structuredContent.change_count + 3);
    await page.evaluate(() => { window.openai.callTool = async () => { throw new Error('host failure'); }; });
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('操作未完成'));
    assert.equal(observed.messages.length, 0);
    await page.evaluate(() => { window.openai.callTool = (name, args) => window.testCall(name, args); });
    await page.locator('#reject').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已拒绝'));
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    assert.equal(observed.messages.length, 0);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

for (const legacyAlias of [false, true]) test(`MCP Apps sizing and host expansion ${legacyAlias ? 'with legacy aliases' : 'without window.openai'}`, async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const messages = [], methods = [], errors = [], contexts = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    await page.exposeFunction('hostRequest', async (message) => {
      methods.push(message.method);
      if (message.method === 'tools/call') return rpc.call(message.params.name, message.params.arguments);
      if (message.method === 'ui/message') { messages.push(message.params); return {}; }
      if (message.method === 'ui/update-model-context') { contexts.push(message.params); return {}; }
      if (message.method === 'ui/request-display-mode') return { mode: message.params.mode };
      return {};
    });
    await page.route('http://mcp-host.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><iframe id="app" style="width:100%;height:340px;border:0"></iframe></body>' }));
    await page.goto('http://mcp-host.test/');
    await page.evaluate(({ html, result, legacyAlias }) => {
      const iframe = document.querySelector('#app');
      let expanded = false;
      const send = (message) => iframe.contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*');
      window.expandSidePanelForTest = () => {
        expanded = true; iframe.style.height = '900px'; iframe.style.width = '620px';
        send({ method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen', containerDimensions: { width: 620, height: 900 } } });
      };
      window.closeSidePanelForTest = () => {
        iframe.style.width = '100%';
        send({ method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline', containerDimensions: { width: 1440, height: 900 } } });
      };
      window.addEventListener('message', async (event) => {
        if (event.source !== iframe.contentWindow || event.data?.jsonrpc !== '2.0') return;
        const m = event.data;
        if (m.method === 'ui/initialize') {
          send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'Test host', version: '1' }, hostCapabilities: { serverTools: {}, message: { text: {} }, updateModelContext: { structuredContent: {} } }, hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } } });
        } else if (m.method === 'ui/notifications/initialized') {
          send({ method: 'ui/notifications/tool-result', params: result });
        } else if (m.method === 'ui/notifications/size-changed') {
          await window.hostRequest(m);
          if (!expanded) iframe.style.height = `${m.params.height}px`;
        } else if (m.id !== undefined) {
          send({ id: m.id, result: await window.hostRequest(m) });
        }
      });
      const legacyScript = '<script>window.openai = {callTool: (name, args) => parent.hostRequest({method: "tools/call", params: {name, arguments: args}}), sendFollowUpMessage: ({prompt}) => parent.hostRequest({method: "ui/message", params: {role: "user", content: [{type: "text", text: prompt}]}})};</script>';
      iframe.srcdoc = legacyAlias ? html.replace('<script>', legacyScript + '<script>') : html;
    }, { html, result, legacyAlias });
    const frame = page.frameLocator('#app');
    await frame.locator('#confirm:not([disabled])').waitFor();
    await page.waitForFunction(() => document.querySelector('#app').getBoundingClientRect().height < 260);
    assert.equal(await frame.locator('#review').isVisible(), false);
    assert.ok(methods.includes('ui/notifications/size-changed'));
    await page.evaluate(() => window.expandSidePanelForTest());
    await frame.locator('#review[open]').waitFor();
    await frame.locator('#confirm:not([disabled])').waitFor();
    assert.equal(await frame.locator('#original').textContent(), original);
    await frame.locator('#confirm').click();
    await frame.locator('#status').filter({ hasText: '已通知主会话' }).waitFor();
    assert.ok(methods.includes('tools/call'));
    // The already expanded host displays both documents without another click.
    assert.equal(await frame.locator('#open-review').isVisible(), false);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content[0].text, '已确认脱敏内容，请使用云端模型继续分析。');
    assert.deepEqual(contexts, [{ structuredContent: { review_id: result.structuredContent.review_id, action: 'continue_confirmed_redaction' } }]);
    await page.evaluate(() => window.closeSidePanelForTest());
    await frame.locator('#open-review').waitFor();
    assert.equal(await frame.locator('#review').isVisible(), false);
    assert.equal(await frame.locator('#bottom-bar').evaluate((element) => element.getBoundingClientRect().top), 0);
    assert.equal(await frame.locator('#confirm').isEnabled(), false);
    // The host's iframe remains 900px tall during its close animation.
    await page.waitForFunction(() => document.querySelector('#app').getBoundingClientRect().height === 900);
    assert.equal(await frame.locator('#review').isVisible(), false);
    assert.doesNotMatch(messages[0].content[0].text, /示例采购有限公司|6222 0202/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('unsupported or rejected model context keeps the review reference in a short fallback message', async () => {
  const rpc = session(), browser = await launch();
  try {
    for (const mode of ['unsupported', 'rejected', 'failed']) {
      const page = await browser.newPage();
      const result = await rpc.call('create_redaction_review', { model: 'unknown', audience: 'main', content: original });
      const observed = await setupOpenAI(page, rpc, { toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
      await page.evaluate((mode) => {
        if (mode === 'unsupported') delete window.openai.setWidgetState;
        else if (mode === 'rejected') window.openai.setWidgetState = () => ({ isError: true });
        else window.openai.setWidgetState = () => { throw new Error('unavailable'); };
      }, mode);
      await page.locator('#confirm').click();
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
      assert.equal(observed.messages[0].prompt, `已确认脱敏内容，请使用云端模型继续分析。 （预览编号：${result.structuredContent.review_id}）`);
      assert.equal(observed.calls.filter((call) => call.name === 'confirm_redaction').length, 1);
      assert.deepEqual(observed.errors, []);
      await page.close();
    }
  } finally { await browser.close(); rpc.close(); }
});

test('notification failure keeps confirmation and retries without generating another token', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: '请检查交付期限：30日。' });
    const observed = await setupOpenAI(page, rpc, { toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    if (await page.locator('#open-review').isVisible()) await page.locator('#open-review').click();
    await page.locator('#review[open]').waitFor();
    assert.equal(await page.locator('#bottom-bar [data-count]').textContent(), '0');
    assert.match(await page.locator('#bottom-bar [data-summary-title]').textContent(), /未记录替换/);
    await page.evaluate(() => { window.openai.sendFollowUpMessage = async () => { throw new Error('message rejected'); }; });
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('确认已保存'));
    assert.equal(await page.locator('#continue').isVisible(), true);
    assert.equal(await page.locator('#edit').isEnabled(), false);
    const before = await rpc.call('preview_redaction', { review_id: result.structuredContent.review_id, audience: 'main' });
    assert.equal(before.structuredContent.status, 'confirmed');
    await page.evaluate(() => { window.openai.sendFollowUpMessage = (message) => window.testMessage(message); });
    await page.locator('#continue').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
    const after = await rpc.call('preview_redaction', { review_id: result.structuredContent.review_id, audience: 'main' });
    assert.equal(before.structuredContent.handoff_token, after.structuredContent.handoff_token);
    assert.equal(observed.calls.filter((item) => item.name === 'confirm_redaction').length, 1);
    assert.equal(observed.messages.length, 1);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('bottom summary stays separate and clickable while a short host shows both comparison panes', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 380 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    const observed = await setupOpenAI(page, rpc, { toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('.summary').count(), 1);
    assert.equal(await page.locator('#review .summary, #review #confirm, #review #status').count(), 0);
    if (await page.locator('#open-review').isVisible()) await page.locator('#open-review').click();
    const layout = await page.evaluate(() => {
      const rect = (id) => document.querySelector(id).getBoundingClientRect().toJSON();
      return { footer: rect('#bottom-bar'), dialog: rect('#review'), left: rect('#original'), right: rect('#sanitized-preview'), viewport: window.innerHeight };
    });
    assert.equal(Math.round(layout.footer.bottom), layout.viewport);
    assert.ok(layout.dialog.bottom <= layout.footer.top);
    assert.ok(layout.left.height >= 70, `original pane has only ${layout.left.height}px`);
    assert.ok(layout.right.height >= 70, `sanitized pane has only ${layout.right.height}px`);
    await page.locator('#original').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.equal(await page.locator('#sanitized-preview').evaluate((element) => element.scrollTop), 0);
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'redaction-short-host.png') });
    // A footer action must remain usable even while the comparison popup is open.
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
    assert.equal(observed.messages.length, 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('#bottom-bar').isVisible(), true);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('inline card starts at the top and reports content height rather than retaining empty viewport space', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 420 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    await setupOpenAI(page, rpc, { displayMode: 'inline', toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    await page.waitForFunction(() => Number.isFinite(window.reportedHeight));
    const layout = await page.evaluate(() => ({ top: document.querySelector('#bottom-bar').getBoundingClientRect().top, height: document.querySelector('#bottom-bar').getBoundingClientRect().height, body: document.body.getBoundingClientRect().height, reported: window.reportedHeight }));
    assert.equal(layout.top, 0);
    assert.equal(Math.ceil(layout.height), layout.reported);
    assert.ok(Math.abs(layout.body - layout.height) <= 1);
    assert.ok(layout.reported < 220, `inline card reports ${layout.reported}px`);
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('#repreview').isVisible(), false);
    // Simulate the host applying the intrinsic height to the inline iframe.
    await page.setViewportSize({ width: 1200, height: layout.reported });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bottom = await page.locator('#bottom-bar').evaluate((element) => element.getBoundingClientRect().bottom);
    assert.ok(bottom <= layout.reported);
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.locator('#bottom-bar').screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'redaction-inline.png'), animations: 'disabled' });
  } finally { await browser.close(); rpc.close(); }
});

test('expanding into a narrow side panel automatically fills it with both documents, including resize-only hosts', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 340 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    const observed = await setupOpenAI(page, rpc, { toolOutput: result.structuredContent, toolResponseMetadata: { status: 'success', mcp_tool_result: result } });
    assert.equal(await page.locator('#review').isVisible(), false);
    // No displayMode notification: Codex side-panel expansion may only resize.
    await page.setViewportSize({ width: 620, height: 1000 });
    await page.locator('#review[open]').waitFor();
    assert.equal(await page.locator('#original').textContent(), original);
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { review: rect('#review'), original: rect('#original'), sanitized: rect('#sanitized-preview'), footer: rect('#bottom-bar'), width: innerWidth, height: innerHeight };
    });
    assert.equal(layout.review.top, 0);
    assert.ok(layout.original.height > 550);
    assert.ok(layout.sanitized.height > 550);
    assert.ok(layout.sanitized.right <= layout.width);
    assert.ok(layout.footer.top >= layout.review.bottom - 1);
    assert.equal(Math.round(layout.footer.bottom), layout.height);
    assert.equal(await page.locator('#review .summary').count(), 0);
    assert.equal(await page.locator('#open-review').isVisible(), false);
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'redaction-side-panel.png') });
    await page.setViewportSize({ width: 1200, height: 340 });
    await page.waitForFunction(() => !document.querySelector('#review').open);
    assert.equal(await page.locator('#bottom-bar').evaluate((element) => element.getBoundingClientRect().top), 0);
    // Also support a fullscreen notification when dimensions have not changed yet.
    await page.evaluate(() => { window.openai.displayMode = 'fullscreen'; window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { displayMode: 'fullscreen' } } })); });
    await page.locator('#review[open]').waitFor();
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
    await page.evaluate(() => { window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { displayMode: 'fullscreen' } } })); });
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('explicit inline mode remains compact in a tall frame before and after native panel closing', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    const observed = await setupOpenAI(page, rpc, { displayMode: 'inline', toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    assert.equal(await page.locator('#review').isVisible(), false);
    await page.waitForFunction(() => window.reportedHeight < 240);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.evaluate(() => { window.openai.displayMode = 'fullscreen'; window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { displayMode: 'fullscreen' } } })); });
      await page.setViewportSize({ width: 620, height: 1000 });
      await page.locator('#review[open]').waitFor();
      await page.locator('#original').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      // Native X changes mode first, with a reused, still-tall inline iframe.
      await page.evaluate(() => { window.openai.displayMode = 'inline'; window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { displayMode: 'inline' } } })); });
      assert.equal(await page.locator('#review').isVisible(), false);
      await page.waitForFunction(() => window.reportedHeight < 300);
      await page.setViewportSize({ width: 1200, height: 900 });
      await deliver(page, result);
      await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
      assert.equal(await page.locator('#review').isVisible(), false);
      assert.equal(await page.locator('#review-backdrop').isVisible(), false);
      assert.equal(await page.locator('#bottom-bar').evaluate((element) => element.getBoundingClientRect().top), 0);
      assert.equal(await page.locator('#open-review').isVisible(), true);
      assert.equal(await page.locator('.summary').count(), 1);
    }
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.locator('#bottom-bar').screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'after-native-close.png'), animations: 'disabled' });
    }
    assert.equal(observed.messages.length, 0);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('local close wins immediately and a delayed expansion response cannot reopen the comparison', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 380 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    const observed = await setupOpenAI(page, rpc, { displayMode: 'inline', toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    await page.evaluate(() => {
      window.pendingExpansions = [];
      window.openai.requestDisplayMode = ({ mode }) => mode === 'fullscreen' ? new Promise((resolve) => window.pendingExpansions.push(resolve)) : Promise.resolve({ mode: 'inline' });
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.locator('#open-review').click();
      await page.locator('#review[open]').waitFor();
      await page.locator('#close-review').click();
      assert.equal(await page.locator('#review').isVisible(), false);
      await page.waitForFunction(() => window.reportedHeight < 220);
      await page.evaluate(() => window.pendingExpansions.shift()({ mode: 'fullscreen' }));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#review').isVisible(), false);
      assert.equal(await page.locator('#open-review').isVisible(), true);
    }
    assert.equal(observed.messages.length, 0);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('closing a fullscreen comparison immediately preserves draft edits and confirmation state', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 620, height: 1000 } });
    const result = await rpc.call('create_redaction_review', { model: 'gpt-6-luna', audience: 'main', content: original });
    await setupOpenAI(page, rpc, { displayMode: 'fullscreen', toolOutput: result.structuredContent, toolResponseMetadata: result._meta });
    await page.locator('#edit').click();
    const draft = result.structuredContent.sanitized_content;
    await selectText(page, '30日');
    await page.locator('#close-review').click();
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    assert.equal(await page.locator('#sanitized').inputValue(), draft);
    await page.locator('#open-review').click();
    await page.locator('#review[open]').waitFor();
    assert.equal(await page.locator('#sanitized').inputValue(), draft);
    await page.locator('#repreview').click();
    await page.waitForFunction(() => !document.querySelector('#confirm').disabled);
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已通知主会话'));
    await page.locator('#close-review').click();
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('#confirm').isEnabled(), false);
    assert.match(await page.locator('#status').textContent(), /已通知主会话/);
    const recovered = await rpc.call('preview_redaction', { review_id: result.structuredContent.review_id, audience: 'main' });
    assert.equal(recovered.structuredContent.status, 'confirmed');
  } finally { await browser.close(); rpc.close(); }
});

test('English review localizes labels, accessibility, errors and continuation while keeping Chinese document text', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 420 } });
    const observed = await setupOpenAI(page, rpc);
    const result = await rpc.call('create_redaction_review', { model: 'unknown', audience: 'main', response_language: 'en', content: original });
    await deliver(page, result);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#confirm').textContent(), 'Confirm and continue');
    assert.equal(await page.locator('#reject').textContent(), 'Reject and stop');
    assert.equal(await page.locator('#close-review').getAttribute('aria-label'), 'Close redaction comparison');
    assert.equal(await page.locator('#original').textContent(), original);
    assert.match(await page.locator('[data-chips]').textContent(), /Parties|Accounts/);
    await page.locator('#open-review').click();
    await page.locator('#edit').click();
    await selectText(page, '30日');
    await page.evaluate(() => { window.restoreCall = window.openai.callTool; window.openai.callTool = async () => ({ structuredContent: { ok: false, error: { code: 'sensitive_value_detected' } } }); });
    await page.locator('#repreview').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('still contains sensitive information'));
    assert.doesNotMatch(await page.locator('#status').textContent(), /[\u3400-\u9fff]/u);
    await page.evaluate(() => { window.openai.callTool = window.restoreCall; });
    await page.locator('#repreview').click();
    await page.waitForFunction(() => !document.querySelector('#confirm').disabled);
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('main chat was notified'));
    assert.equal(observed.messages[0].prompt, 'Redaction confirmed. Please continue the analysis with the cloud model.');
    assert.equal(await page.locator('#confirm').textContent(), 'Confirmed');
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('custom review translations render safely and survive host metadata and confirmation', async () => {
  const rpc = session(), browser = await launch();
  try {
    const args = { model: 'unknown', audience: 'main', response_language: 'ja', content: original };
    const pending = await rpc.call('create_redaction_review', args);
    const source = pending.structuredContent.ui_translation_source;
    const translations = Object.fromEntries(Object.keys(source).map((key) => [key, key.includes('{review_id}') ? '確認済みです。続けてください。（確認番号：{review_id}）' : '表示テキスト']));
    translations['确认并继续'] = '確認して続行';
    translations['已确认脱敏内容，请使用云端模型继续分析。'] = '確認済みです。サブエージェントで分析を続けてください。';
    translations['已确认，已通知主会话调用云端模型。'] = 'メインチャットに通知しました。';
    translations['原始内容'] = '<b>原文</b>';
    const result = await rpc.call('create_redaction_review', { ...args, ui_translations: translations });
    const page = await browser.newPage({ viewport: { width: 1440, height: 420 } });
    const observed = await setupOpenAI(page, rpc);
    await deliver(page, result);
    assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
    assert.equal(await page.locator('#confirm').textContent(), '確認して続行');
    assert.equal(await page.locator('.original h2').textContent(), '<b>原文</b>');
    assert.equal(await page.locator('.original h2 b').count(), 0);
    assert.equal(await page.locator('#original').textContent(), original);
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'メインチャットに通知しました。');
    assert.equal(observed.messages[0].prompt, '確認済みです。サブエージェントで分析を続けてください。');
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('cloud settings page saves custom provider/model, reloads them and keeps review intact', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 620, height: 900 } });
    const review = await rpc.call('create_redaction_review', { model: 'local', audience: 'main', content: original });
    const observed = await setupOpenAI(page, rpc, { displayMode: 'inline', toolOutput: review.structuredContent, toolResponseMetadata: review._meta });
    await page.locator('#open-cloud-settings').click();
    await page.locator('#cloud-model').waitFor({ state: 'visible' });
    await page.locator('#cloud-provider-mode').selectOption('custom');
    await page.locator('#cloud-provider').fill('my_gateway');
    await page.locator('#cloud-base-url').fill('https://my.example/v1');
    assert.equal(await page.locator('#cloud-api-key').getAttribute('type'), 'password');
    await page.locator('#cloud-api-key').fill('sk-synthetic-ui-key');
    await page.locator('#cloud-model').fill('vendor-large-model');
    // Valid millisecond precision must not fail integer validation due to floating-point rounding.
    await page.locator('#cloud-timeout').fill('1.001');
    await page.locator('#cloud-save').click();
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('已保存'));
    assert.equal(await page.locator('#cloud-api-key').inputValue(), '');
    const saved = (await rpc.call('open_cloud_settings')).structuredContent.config;
    assert.equal(saved.provider, 'my_gateway'); assert.equal(saved.model, 'vendor-large-model'); assert.equal(saved.timeout_ms, 1001);
    assert.equal(saved.api_key, undefined);
    assert.match(await page.locator('#cloud-key-hint').textContent(), /已保存/);
    await page.locator('#cloud-model').fill('unsaved');
    await page.locator('#cloud-reload').click();
    await page.waitForFunction(() => document.querySelector('#cloud-model').value === 'vendor-large-model');
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'cloud-settings.png'), fullPage: true });
    await page.locator('#close-cloud-settings').click();
    assert.equal(await page.locator('#confirm').isEnabled(), true);
    assert.equal((await rpc.call('preview_redaction', { audience: 'main', review_id: review.structuredContent.review_id })).structuredContent.status, 'awaiting_confirmation');
    assert.equal(observed.calls.some(call => call.name === 'run_cloud_analysis'), false);
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('standalone settings page supports OpenAI, errors and English labels without a review', async () => {
  const rpc = session(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 620, height: 900 } });
    const output = await rpc.call('open_cloud_settings', { response_language: 'en' });
    const observed = await setupOpenAI(page, rpc, { toolOutput: output.structuredContent, toolResponseMetadata: output._meta });
    assert.equal(await page.locator('#cloud-settings').isVisible(), true);
    assert.equal(await page.locator('#confirm').isVisible(), false);
    assert.equal(await page.locator('#cloud-save').textContent(), 'Apply settings');
    await page.locator('#cloud-provider-mode').selectOption('openai');
    await page.locator('#cloud-model').fill('my-openai-model');
    await page.locator('#cloud-save').click();
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('settings saved'));
    const saved = (await rpc.call('open_cloud_settings')).structuredContent.config;
    assert.equal(saved.provider, 'openai'); assert.equal(saved.base_url, ''); assert.equal(saved.api_key_env, '');
    await page.locator('#cloud-provider-mode').selectOption('custom');
    await page.locator('#cloud-provider').fill('custom'); await page.locator('#cloud-base-url').fill('http://insecure.example'); await page.locator('#cloud-api-key').fill('sk-synthetic-other-key');
    await page.locator('#cloud-save').click();
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('Enter an HTTPS'));
    assert.equal((await rpc.call('open_cloud_settings')).structuredContent.config.provider, 'openai');
    assert.deepEqual(observed.errors, []);
  } finally { await browser.close(); rpc.close(); }
});

test('standalone settings restore native drafts on mobile and protect newer settings from an old form', async () => {
  const rpc = session(), browser = await launch();
  try {
    await rpc.call('cloud_settings_update', { set: { model: 'draft-model' } });
    const output = await rpc.call('open_cloud_settings', { response_language: 'zh-CN' });
    const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
    const observed = await setupOpenAI(page, rpc, { toolOutput: output.structuredContent });
    assert.match(await page.locator('#cloud-status').textContent(), /已恢复/);
    assert.equal(await page.locator('#cloud-model').inputValue(), 'draft-model');
    assert.match(await page.locator('#cloud-current').textContent(), /test-large/);
    assert.equal(await page.locator('#close-cloud-settings').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'cloud-settings-mobile.png'), fullPage: true });
    }
    await rpc.call('save_cloud_settings', { config: { provider: 'openai', model: 'newer-model' } });
    await page.locator('#cloud-save').click();
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('其他页面'));
    assert.equal(await page.locator('#cloud-save').isDisabled(), true);
    assert.equal((await rpc.call('select_cloud_model')).structuredContent.selected_model, 'newer-model');
    await page.locator('#cloud-reload').click();
    await page.waitForFunction(() => document.querySelector('#cloud-model').value === 'newer-model');
    assert.equal(await page.locator('#cloud-save').isEnabled(), true);
    assert.equal(await page.locator('#cloud-base-url').isDisabled(), true);
    assert.equal(await page.locator('#cloud-custom').isVisible(), false);
    await page.setViewportSize({ width: 1000, height: 850 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (process.env.REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.REVIEW_SCREENSHOT_DIR, 'cloud-settings-desktop.png'), fullPage: true });
    assert.deepEqual(observed.errors, []);
    assert.deepEqual(observed.messages, []);
    assert.equal(observed.calls.some(call => call.name === 'run_cloud_analysis'), false);
  } finally { await browser.close(); rpc.close(); }
});
