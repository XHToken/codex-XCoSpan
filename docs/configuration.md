# Detection configuration

[Project home](../README.md) · [简体中文](zh-CN/configuration.md)

The default configuration is ready to use: rule detection runs offline, and the local main chat performs semantic review. Configure the options on this page only if you need enterprise dictionaries, custom rules, or an additional detection service. See the [usage guide](usage.md) for everyday operations and [Privacy and data flow](privacy.md) for data destinations.

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
