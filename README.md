# codex-XCoSpan

Privacy-aware local and cloud model routing for Codex. The repository name is `codex-XCoSpan`; the installable plugin identifier remains `codex-local-privacy-router` for compatibility.

A local Codex plugin coordinating a locally deployed main-session model with cloud analysis subagents. The main session evaluates each user request by task meaning, sensitivity and source provenance. Complex sensitive material is redacted locally and held for human confirmation before a sanitized package is prepared.

## Routing

| Route | Meaning |
| --- | --- |
| `assessment_required` | Complete the local semantic assessment; no cloud analysis is authorized. |
| `inspect_content` | Inspect actual unread material in scope locally and reassess. |
| `resume` | Continue an existing workflow using its server state and valid authorization. |
| `local` | Handle simple work in the main session. |
| `subagent` | Dispatch complex non-sensitive work to the selected cloud large model. |
| `redaction_required` | Redact complex sensitive content locally and obtain human confirmation. |

For tasks, call `route_request` with `complexity`, `sensitivity`, `data_scope` and a short `assessment_reason` without private values. The local main-session model judges reasoning depth, synthesis, uncertainty, actual confidentiality and provenance. Missing judgments do not silently become low sensitivity or simple work. Complex low-sensitivity tasks with unknown provenance cannot go to the cloud. Contextual format matches appear as `candidate_signals`; mandatory detector findings prevent direct cloud routing: public prices can be non-sensitive, and confidential meaning can have no matches.

The UserPromptSubmit Hook scans every submission locally and emits only unassessed metadata and candidate categories. It does not infer attachments from words, inspect files, or call a model. The main session resolves actual host references and task scope. This avoids treating a statement about attachments, including a negation, as an actual unread file. Public research objectives can be dispatched immediately after assessment and model selection; the subagent retrieves, extracts, verifies and analyzes public sources. Unread user-supplied/private material is inspected locally first. Local origin alone does not imply sensitivity.

For unchanged workflow continuations, use `request_kind=continuation` and the applicable `review_id`. Read server state before proceeding; do not recreate valid consent or selection. Linked reviews cannot be bypassed by relabeling material as public or non-sensitive. Changed scope or content requires a fresh task assessment. Inspecting or editing this plugin is maintenance and does not execute its routing/confirmation workflow.

## Subagents and models

All analysis subagents skip Edge-Cloud Collaboration entirely. Direct and sanitized handoff messages share an explicit plugin-exemption prefix; subagents do not load its skill or execute its Hooks/MCP workflow, ask deployment or model-choice questions, reconfirm redaction, or create another subagent. Other host instructions and task skills remain applicable. SessionStart and UserPromptSubmit check host role metadata; a role gate also covers missing metadata. Task text cannot change the host execution role. Hosts control tool exposure; these fields are not authentication.

The host supplies its complete available-model list and identifies eligible large models through capability descriptions. There is no model-name blacklist or fixed model-version list. Multiple candidates require the user's choice; a sole eligible candidate is announced and used. No candidate means no cloud analysis. Set `model` and `fork_turns="none"` as actual host creation arguments. The plugin validates caller-supplied lists and selections but cannot independently prove capability or deployment. Selection lasts 30 minutes and is task-scoped.

The main session confirms local deployment once and reuses that confirmation until the user changes models or withdraws it. The compatibility field `user_confirmed_small_model` means confirmed local deployment; `is_small_model` is null because names are not capability evidence. Redaction consent remains separate.

## Context-aware redaction

Before sensitive handoff, call `detect_sensitive_content` for local candidates. The local model then identifies sensitive passages and sends `sensitive_spans=[{start,end,type},...]` to `create_redaction_review`. Offsets use UTF-16 indices in the exact content string. These spans cover all sensitive facts, including meaning that has no account, phone or label format. When supplied, they are the complete contextual redaction selection. Overlapping spans merge; repeated values reuse stable placeholders. Unselected original pattern candidates are treated as reviewed non-sensitive values, so public figures can remain alongside redacted private passages.

Omitting spans produces an automatic preview masking all detected candidates for compatibility. Required secrets, identity numbers, validated cards and locally configured mandatory categories are added to every selection, including revisions. Contextual amounts, dates and organizations may remain after semantic review. Built-in and custom patterns are aids, not complete privacy assessment. Changed content and semantic edits require local reassessment. Tools validate offsets, recognized formats and known originals, but cannot independently certify semantic completeness or public provenance. New unreviewed recognizable values cannot be introduced through edits or a task description; previously reviewed public candidates can remain.

The UI uses neutral content labels across domains. Its inline card shows replacement statistics and actions. Compare opens a two-column original/redacted view, including expanded host panels; returning inline or closing preserves draft state. The redacted side supports selecting sensitive text and applying a structured mask; direct prose rewriting is disabled. Original text and mappings stay in process memory and UI-only metadata; they are not sent in cloud packages or persisted by this service.

Confirm and continue saves human consent, then sends a short localized continuation. The review ID is delivered through model context where supported, with a visible-ID fallback for older hosts or failed context updates. The main session reads current state with `preview_redaction`, obtains the token and sanitized hash, resolves cloud selection and calls `handoff_to_subagent`. Edits invalidate consent; rejection/revocation stop handoff. Reviews expire after 30 minutes. The token is used once. Confirmation does not itself create or upload a cloud task.

After creating a valid preview, the main session briefly requests confirmation and ends its turn. After confirmation, it creates the analysis subagent and waits for its findings before preparing the answer. Existing review states return explicit next-step instructions; the UI notification asks for subagent handoff rather than generic continuation. The plugin does not intercept other host tools or enforce turn termination. These steps still rely on the model following instructions, and an explicit user request for local processing takes precedence.

For sensitive handoff, keep outer workflow fields in the main session, use returned `spawn_parameters` as actual host arguments, and send only `subagent_payload` containing `execution_role`, `subagent_instructions`, `task` and `sanitized_content`. For direct non-sensitive handoff, send the role, the model selection's full instruction prefix, task and minimum non-sensitive context. The cloud model returns evidence and uncertainty; the main session checks and presents the result.

## Language and compatibility

User-facing replies follow the current user's language or explicit preference; short continuations retain the task language. Pass `response_language` explicitly. UI labels, actions, errors and continuation are built in for Chinese and English. Other languages use a complete locally translated `ui_translations` dictionary. Documents, placeholders and protocol identifiers are not translated automatically. Existing resource URIs and compatibility manifests are retained.

## Platform support

One package supports Windows, macOS and Linux with Node.js 20+. Hooks invoke the existing Node.js entry points directly; Git Bash, WSL and `/bin/sh` are not required. The optional `node install.mjs` installer uses native `codex.exe` or the npm Codex entry point on Windows, passing arguments without a command shell. Paths containing spaces or Unicode are supported. Node and the Codex CLI must be discoverable in the client/terminal environment. Restart the client after installing Node if its PATH is stale.

See [中文安装说明](INSTALL-ZH.md) for ZIP import and local installation. Windows-specific resolution is covered by automated fixtures; a native Windows desktop test has not been performed in this macOS workspace.

## Run, test and install

Build and test commands below apply to the development source checkout. The import ZIP contains the built runtime and does not need npm installation or a build.

```sh
node ./mcp/server.mjs --self-check
npm run build:ui
npm test
```

The MCP server has no third-party runtime dependencies and needs no Python. UI builds require the package's development dependencies; browser tests require Chrome or `PLAYWRIGHT_CHROME`. UI client version is derived from package metadata at build time.

Register the marketplace root containing `.agents/plugins/marketplace.json`, then install or refresh the plugin through the host's supported flow:

```sh
codex plugin marketplace add /absolute/path/to/marketplace-root
codex plugin add codex-local-privacy-router@local-workspace
codex plugin list --marketplace local-workspace --json
```

Update source and version, then reinstall; do not edit the installation cache. Start a new chat to load updated instructions and service code. Review/trust Hooks in the host if required. Enabled plugins do not automatically have trusted Hooks. Current previews retain their original state and do not update retroactively.

## Canonical redaction revisions (0.1.18)

Generated previews are validated before display using the same rules as confirmation and handoff. Registered placeholders are excluded from residual scans, including table fields with adjacent masks. Validation failures return stage, category and positions without sensitive values. New arbitrary placeholders and raw rewrites are rejected; a zero replacement count is explicitly not a privacy guarantee.

To redact more, select text in the UI, or call `preview_redaction` with `redactions` in current sanitized coordinates and the current `expected_sanitized_sha256`. Identical values are masked consistently and all other text is retained. Complete corrected `sensitive_spans` in original coordinates can repair an earlier overly broad selection. The server owns token registration, stable IDs and replacement statistics. Real changes clear consent; unchanged operations preserve it. Multi-block masks require `scope=passage` and a reason. Retention metrics and a visible passage warning help identify lost task meaning; local semantic review is still necessary. An old summary-style preview needs to be rebuilt from its original source.

## General-purpose detection (0.1.0)

The Node.js engine combines rules, a configurable enterprise dictionary and an optional local model. Default operation uses offline rules plus the existing local Codex main session for semantic review; no independent model service is required. Amounts, dates and organizations are contextual, while secrets, identity numbers and validated bank cards receive mandatory protection. Custom categories can also require masks. All enabled detectors must succeed. Custom regex runs in a terminable worker; optional model responses require valid, exact UTF-16 spans, and long input uses overlapping chunks.

Both preview creation and the direct-cloud routing path scan locally. A review binds the detected findings and policy hash; revisions retain required masks and policy changes require a new review. Handoff scans task instructions and rechecks authorization after asynchronous work. Detector results contain only coordinates and types. Existing UI-only original mappings, stable placeholders, confirmation and one-time handoff semantics are retained.

See [检测配置与通用策略](DETECTION-ZH.md) for local JSON configuration and optional model deployment. The default configuration works without extra setup. Independent model endpoints are opt-in; loopback is supported, and non-loopback endpoints require HTTPS and an explicit trusted origin. No public-model endpoint is bundled or automatically selected. Model availability and semantic accuracy need deployment-specific validation.
