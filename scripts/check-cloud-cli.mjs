// Real Codex CLI + a synthetic Responses service. No cloud inference or private
// inputs. Verify advertised tools, command execution, networking and file writes.
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCloudExec } from '../mcp/cloud-exec.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-cli-check-'));
const requests = [];
let step = 0, probeCount = 0, target, probeUrl;
const sentence = 'Offline CLI integration passed.';
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function respond(res, item) {
  const response = { id: 'resp_test_' + step, object: 'response', created_at: 1, status: 'completed', model: 'test-model', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}
const server = http.createServer(async (req, res) => {
  if (req.url === '/probe') {
    probeCount++;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('synthetic-network-probe');
    return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  requests.push({ url: req.url, body });
  step++;
  if (step === 1) {
    const code = `const fs=require('node:fs');fetch(${JSON.stringify(probeUrl)}).then(r=>r.text()).then(text=>{fs.writeFileSync(${JSON.stringify(target)},text);console.log('HARNESS_PROBE_OK '+text)}).catch(e=>{console.error(e.message);process.exitCode=1})`;
    respond(res, { id: 'fc_probe', type: 'function_call', call_id: 'call_probe', name: 'exec_command', arguments: JSON.stringify({ cmd: shellQuote(process.execPath) + ' -e ' + shellQuote(code), max_output_tokens: 500, yield_time_ms: 1000 }), status: 'completed' });
  } else {
    respond(res, { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: sentence, annotations: [] }] });
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
probeUrl = `http://127.0.0.1:${server.address().port}/probe`;
try {
  for (const sanitized of [false, true]) {
    requests.length = 0; step = 0;
    target = path.join(directory, sanitized ? 'sanitized.txt' : 'public.txt');
    const result = await runCloudExec({ provider: 'offline', model: 'test-model', base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'synthetic', timeout_ms: 20000 }, { instructions: 'Execute the synthetic loopback probe, then reply with the test sentence.', task: 'Synthetic offline integration test.' }, { sanitized });
    assert.equal(result, sentence);
    assert.equal(requests.length, 2, 'The CLI must return the tool result to the model');
    for (const request of requests) {
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.body.model, 'test-model');
    }
    const toolNames = requests[0].body.tools?.map(tool => tool.name || tool.type) || [];
    assert.ok(toolNames.includes('exec_command'), 'Built-in command tool must be available: ' + JSON.stringify(toolNames));
    assert.ok(toolNames.includes('write_stdin'), 'Built-in session tool must be available');
    assert.ok(toolNames.includes('view_image'), 'Image viewing must not be forcibly disabled');
    assert.equal(await fs.readFile(target, 'utf8'), 'synthetic-network-probe', 'Full-access command must write outside its temporary working directory');
    assert.match(JSON.stringify(requests[1].body.input), /HARNESS_PROBE_OK synthetic-network-probe/, 'The actual shell/network result must reach the next model turn');
    if (sanitized) assert.equal(toolNames.includes('web_search'), false);
    console.log(`${sanitized ? 'Sanitized' : 'Public'} worker: built-in command tool executed, loopback network fetched, external temporary file written, tool result returned.`);
  }
  assert.equal(probeCount, 2);
  console.log('Real Codex CLI integration passed using synthetic local Responses calls; no cloud inference.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
