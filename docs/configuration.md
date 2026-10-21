# Model connection and detection configuration

[Project home](../README.md) · [简体中文](zh-CN/configuration.md)

First connect the models as described below. Detection needs no additional setup by default: rules run offline, and the local main chat performs semantic review. Enterprise dictionaries, custom rules and a separate detection service are optional. See the [usage guide](usage.md) for everyday operations and [Privacy and data flow](privacy.md) for data destinations.

## Model providers and API protocol

### Current Codex subagent limitation

As of 2026-10-21, native Codex subagents inherit the parent session's provider. They can use a different model ID, but a custom agent's `model_provider` does not override the parent's provider. See the [official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents).

The `main` plugin creates native subagents through host tools; it cannot supply a separate provider, endpoint or credential set for the cloud subagent. Merely configuring two providers or writing a cloud model name in the task does not connect them independently.

### main: unify local and cloud models behind a gateway

Before using local/cloud collaboration on `main`:

1. Use a third-party gateway to expose the local main-session model and cloud analysis model through one provider/base URL, with distinct model IDs that route to the intended backend.
2. Make that entry point speak the **Responses API** for both models, including the streaming and tool-call behavior Codex needs. If a backend only supports Chat Completions or another protocol, the gateway must adapt requests and responses; changing the endpoint path alone is insufficient. See [gateway compatibility requirements](https://learn.chatgpt.com/docs/enterprise/gateway-compatibility).
3. Configure that provider in the host's user-level Codex configuration. Select the local model for the main session and make the cloud model available for subagent selection through the same provider. Verify the actual routes before submitting private material.

The plugin does not install a gateway, deploy models or perform this protocol conversion. The gateway handling main-session requests can see original material: deploy that path locally or in the approved environment needed for your privacy boundary, and route the main-session model to local inference. One shared URL does not itself make inference local. See [privacy and data flow](privacy.md).

### exec: use a separate Codex process for cloud analysis

If the main session and cloud analysis need different providers, install the [`exec` branch](https://github.com/XHToken/codex-XCoSpan/tree/exec). It replaces the native subagent with a separate `codex exec` process whose provider, base URL and credentials are configured independently. A shared provider entry point is no longer required, but **both model endpoints must still provide Responses API compatibility**, directly or through an adapter; Exec does not convert arbitrary model protocols.

Install **Edge-Cloud Collaboration (Exec)** (`codex-local-privacy-router-exec`) using the [Exec installation steps](installation.md#install-the-exec-alternative), then configure its cloud model on the plugin detail page. Main and Exec have independent identities and settings; enable one version per chat.

### Optional detector uses a separate protocol

These Responses API requirements apply to Codex main-session and cloud-analysis inference. The optional `local_model` detector below is a separate service invoked by MCP and still uses **Chat Completions**. It neither selects the main-session provider nor configures subagent or Exec routing.

## Protection categories

`secret`, `government_id`, and `bank_card` require redaction by default and cannot be downgraded through configuration. The main chat assesses amounts, dates, company names, and similar information in the context of the task. Neither a format match nor zero matches constitutes a complete privacy assessment.

## Enterprise dictionaries and rules

Copy the [example configuration](../config/detection.example.json) to a controlled location outside the plugin directory, then set `PRIVACY_ROUTER_CONFIG` to its absolute JSON path. Make sure the process starting Codex/MCP inherits the variable, and restart the relevant MCP service for the change to take effect. Keep enterprise dictionaries out of distribution packages and avoid editing the installation cache. Tool calls cannot arbitrarily select configuration files or model endpoints.

Example configuration with synthetic entries:

```json
{
  "version": "enterprise-1",
  "categories": {
    "project_code": "mask",
    "organization": "contextual",
    "amount": "contextual",
    "date": "contextual"
  },
  "dictionary": [
    { "term": "Orion-Example", "type": "project_code", "action": "mask", "case_sensitive": false }
  ],
  "rules": [
    { "type": "project_code", "pattern": "Internal ID[:：]([A-Z]{2}-[0-9]{6})", "group": 1 }
  ],
  "rule_timeout_ms": 2000,
  "local_model": { "enabled": false }
}
```

- Category actions support `mask` and `contextual`.
- Dictionary entries match literal text, ignore case by default, and check English word boundaries. Set `whole_word:false` to disable the boundary check. Repeated entities with the same category and original value reuse the same placeholder.
- Rules use JavaScript regular expressions. `group` is a numeric capture-group index; by default, the entire match is redacted. Optional `flags` can combine `i/m/s/u`. Escape backslashes in JSON.
- Limits: 128 rules, 5,000 dictionary entries, and 200,000 UTF-16 code units per call. Rules run in worker threads and are terminated on timeout. Syntax errors and invalid capture groups are not treated as zero matches.
- An automatic public-information allowlist cannot override mandatory protection. Assess public information in context so a broad entry does not allow an embedded secret through.
- Omitted fields use defaults; unknown configuration fields produce errors. Configuration changes prevent old previews from being confirmed or handed off, so generate a new preview.

## Optional detection service

For additional automated semantic detection, replace the configuration's `local_model` value with the following object. The endpoint must already provide a Chat Completions-compatible service:

```json
{
  "enabled": true,
  "base_url": "http://127.0.0.1:11434/v1",
  "model": "YOUR_INSTALLED_LOCAL_MODEL",
  "timeout_ms": 120000,
  "chunk_chars": 3000,
  "overlap_chars": 256
}
```

Replace `model` with the ID of your deployed model. The plugin does not download models or automatically expose the current Codex model as an HTTP service. Loopback addresses are supported by default. Other addresses must use HTTPS and explicitly list their full origin in `trusted_origins`, such as `https://privacy-model.example.internal:8443`. This configuration records an administrator-approved service; the plugin cannot verify that a remote server is actually on an internal network. Redirects are rejected, preventing requests from being redirected to unapproved addresses.

For authentication, use `api_key_env` to name an environment variable containing the key. Keep the key value out of configuration files, logs, and installation packages. HTTP requests contain source-text chunks and are sent only to the explicitly configured detection endpoint. Model output must include a `findings` array with `type/start/end/text` in each item. Offsets use UTF-16, and each source slice must exactly match `text`. Unknown categories, missing fields, invalid offsets, invalid JSON, unavailable services, and timeouts block the operation. Detection does not silently fall back to rules alone and proceed with outbound handoff.

By default, at most two chunks are processed concurrently. Chunks overlap, and duplicate findings are removed. The overlap cannot preserve every semantic relationship across chunks, so the main chat must still review the result. `timeout_ms` is the budget for the entire model detection operation. Local tests cover the simulated endpoint protocol and failure paths; recognition accuracy, long-document performance, and latency must be validated with the deployed model.

## Troubleshooting

Detection failures block the operation. Error messages do not echo original sensitive values, configuration contents, or model responses.

| Error code | What to check |
| --- | --- |
| `invalid_detection_config` | Validity of JSON fields, rules, and parameter ranges |
| `untrusted_model_endpoint` | HTTPS for non-loopback endpoints and an exact origin entry in `trusted_origins` |
| `rule_detection_timeout` | Excessively slow custom regular expressions |
| `invalid_model_output` | Valid JSON, supported categories, and UTF-16 ranges that exactly match the source text |
| `model_unavailable` | Detection service address, authentication, and availability |
| `model_detection_timeout` | Total detection time, input length, and the time budget |

Fix the configuration or service, then retry. Policy changes require a new preview. Do not remove required detectors or rewrite findings merely to permit a handoff.
