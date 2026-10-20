# Routing and cloud protocol

The main-session workflow is defined in [SKILL.md](../SKILL.md). Cloud work uses MCP-managed `codex exec`, never host subagent creation.

| Tool | Contract |
| --- | --- |
| `route_request` | Semantic assessment plus required detection. `cloud_exec` returns a 30-minute request ID bound to the exact prompt/context and detector policy. |
| `open_cloud_settings` | Open standalone settings from the plugin page; in chat, use only when requested or as an older-client fallback. No inference. |
| `cloud_settings_read` / `cloud_settings_update` | App-only native detail-page form and draft persistence; editing does not activate a cloud model. |
| `cloud_settings_apply` / `cloud_settings_reset` | App-only actions to validate/activate or discard the draft. |
| `save_cloud_settings` | App-visible mutation; validate and atomically save provider/model/HTTPS URL/key variable name/timeout. No secret values. |
| `select_cloud_model` | Return a selection handle bound to the saved configuration revision for 30 minutes. |
| `detect_sensitive_content` | Local required/contextual findings with UTF-16 offsets, never raw values. |
| `create_redaction_review` | Immutable original plus canonical redacted text and UI-only original mapping. |
| `preview_redaction` | Main-session read or structured edit with exact version hash. Preserve unselected text and required masks. |
| `confirm_redaction` | Human authorization produces one-time token; cannot reconfirm running/completed reviews. |
| `revoke_redaction` | Invalidate unsent authorization; cannot recall a started job. |
| `run_cloud_analysis` | Use a routed request ID OR a confirmed review/token/hash, plus a valid model selection. No arbitrary replacement input for direct jobs. Returns job ID. |
| `get_cloud_result` | Read running/completed/failed job state. No side effects and no automatic retry. |

Sensitive state: `awaiting_confirmation → confirmed → running → completed|failed`; rejection/revocation stop unsent work. Failed jobs require fresh consent before a new sensitive execution. Changed content invalidates authorization. Detection policy changes require a new review. Configuration changes invalidate selection handles. Async validation rechecks state before token consumption. Each job snapshots its provider/model, so later settings changes affect only new jobs.

Public payload: fixed `instructions`, assessed `task`, minimal `context`. Sensitive payload: fixed `instructions`, checked `task`, canonical `sanitized_content`. No original values, replacement records, filenames, file paths, review IDs or tokens enter sensitive CLI stdin. The main session retains control state. The server spawns a process with an argument array and `shell:false`; tasks enter stdin, never command arguments.

Offsets use UTF-16 and cannot split surrogate pairs. Stable placeholders avoid native marker collisions. Structured selections preserve all unselected characters. Repeated required values remain protected. Multiline selections require passage scope/reason. Freeform rewritten summaries are rejected. Scope/meaning remains the local model's responsibility; detection is not semantic proof.

## Node detection engine

Rules and enterprise dictionary run in a worker with a bounded timeout. The optional explicitly configured local model uses overlapping UTF-16 chunks and strict response validation; missing findings, invalid offsets, unknown types, transport errors and timeouts block the operation. Disabled optional model means the main session provides semantic judgment, not that semantic judgment is skipped. Configuration is local JSON referenced by `PRIVACY_ROUTER_EXEC_CONFIG`; see the [configuration guide](../../../docs/configuration.md).

A preview binds the successful detection result and policy hash to its immutable original. Structured edits retain required masks. Changing configuration invalidates the review; recreate it before confirmation. Handoff scans the task instruction too, and rechecks consent/version after asynchronous detection so revocation or concurrent edits win. The `route_request` direct-cloud path also checks required protection before accepting a low-sensitivity declaration. Contextual candidate matches alone still do not establish sensitivity. Tools only govern this plugin workflow; they cannot intercept unrelated host tools.
