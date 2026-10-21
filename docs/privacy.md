# Privacy and data flow

[Home](../README.md) · [简体中文](zh-CN/privacy.md)

This plugin helps the main session assess task sensitivity before choosing local processing, direct cloud analysis, or redaction followed by user confirmation. It governs its own workflow. It is not an independent isolation sandbox and cannot intercept all other Codex tools.

## Who can see which content

| Stage | Content accessed and destination |
| --- | --- |
| Codex main session | Receives your request and reads the original material needed for the task. The model's location depends on the host configuration. The plugin asks for confirmation but cannot verify that the model actually runs locally. |
| Unified model gateway on main | Receives requests for both the local main model and the cloud subagent, including original material in main-session requests. Its placement, model routing and logging must preserve the intended local-processing boundary; a shared Responses API entry point alone does not guarantee locality. |
| Default detection | A local Node.js process runs rules and enterprise dictionaries without calling model endpoints. The main session still performs semantic assessment. |
| Optional separate detection service | Sends chunks of the original text to the configured endpoint only when explicitly enabled. That service can see the content; its operator determines deployment location and data retention. |
| Redaction comparison UI | Receives the original text and replacement mapping through host-provided UI metadata so you can compare both sides. |
| Cloud subagent for sensitive tasks | Receives the confirmed redacted text, checked task instructions, and fixed role instructions. It does not receive the original-text mapping or main-session history. |
| Cloud subagent for complex, non-sensitive tasks | Receives the task objective and the minimum necessary non-sensitive context without requiring redaction confirmation. It can search and analyze public sources independently. |

**Confirm where the main session actually runs before providing sensitive material.** Installing the plugin does not automatically turn a chat using a cloud model into a local chat. The plugin also cannot retract content already sent to the host or model service.

The optional detection endpoint is disabled by default. No public model service is built in or selected automatically. Loopback addresses can be configured directly; non-loopback addresses require HTTPS and an explicitly trusted origin. These checks cannot prove that a remote server is on a private network. See [detection configuration](configuration.md) for setup and authentication.

## Storage and logging

The MCP server holds preview source text, redacted text, replacement mappings, and authorization state in process memory. It does not actively write original text or mappings to disk or error logs. Previews expire after 30 minutes, and stopping the service loses the in-memory state. The confirmation UI does not write original text to browser storage, persisted component state, or continuation messages.

These are boundaries of the plugin's own implementation. The main session has already received or read the original text, and the host may still record chats, tool arguments, and UI data. The plugin does not control data handling by file-reading tools, logging systems, system backups, or model services. How cloud services retain the redacted content they receive depends on the service and settings you choose.

The statement that original text is excluded from the cloud handoff package therefore applies only to this plugin's controlled handoff path. It does not mean that original text can never leave the broader chat environment.

## What you confirm

“Confirm and continue” authorizes the current redacted version. The main session performs the actual handoff and analysis afterward; content changes require confirmation again. Rejecting or revoking stops the current authorization but cannot recall data already sent. See the [usage guide](usage.md) for operating steps and expiry handling.

## Assessment limits

Rules and models can both miss sensitive content or flag harmless content. Secrets, identity document numbers, valid payment card numbers, and similar data receive mandatory protection by default. Amounts, dates, company names, and similar content require assessment based on public sources, task purpose, and confidentiality in context. A replacement count of zero or a successful rule check does not prove that content contains no sensitive information.

Redaction may also remove facts needed to complete the task. When confirming, check both whether sensitive meaning remains and whether the remaining content is sufficient for analysis. If essential information cannot be retained safely, you can explicitly request local processing only. Report vulnerabilities and privacy defects using the [security reporting instructions](../SECURITY.md), with synthetic data in examples.
