# Changelog

All notable changes to this project are documented here.

## [Unreleased]

- Give Exec its own plugin ID, marketplaces, MCP service, UI resource URI, and routing skill so it can be installed alongside main.
- Store Exec cloud settings separately and use `PRIVACY_ROUTER_EXEC_*` overrides without importing main-version settings.
- Pin installation instructions to `exec` and publish Exec packages under independent `exec-v<version>` tags.

- Run cloud CLI workers with full filesystem/network access and no approval prompts; enable shell tools, restore built-in tool defaults, and allow public-source retrieval through shell when hosted search is unavailable.

- Accept API keys directly in the standalone settings password field, persist them locally with restricted file permissions, omit them from tool results, and retain them only for the same provider and URL. Keep legacy environment credentials compatible.

- Expose native cloud model forms on the plugin detail page via `openai/settings`, with a separate MCP App settings entrypoint for ZIP and marketplace installs.
- Persist incomplete settings as drafts; apply validated changes explicitly, protect against stale configurations and support discarding drafts without changing the active model.
- Improve standalone settings with provider-specific fields, active configuration, loading/error states, bilingual labels and responsive layout.
- Preserve millisecond precision when saving fractional-second timeouts from the standalone settings page.

- Replace host subagent cloud handoff with asynchronous MCP-managed `codex exec` jobs and explicit result polling.
- Add persistent plugin-page provider/model settings, custom Responses-compatible endpoints, environment-based credentials and timeouts.
- Preserve sensitive-version consent, detector checks and single-use tokens; bind selections to cloud configuration and isolate CLI state.
- Update Chinese/English setup, usage, architecture, privacy and agent workflow documentation.

## [0.1.0] - 2026-10-17

First packaged release under the `codex-XCoSpan` repository name, following the initial source snapshot on 2026-10-16.

- Local task routing and model selection.
- Context-aware redaction with human confirmation before sensitive handoff.
- Node.js detection engine with configurable rules, dictionary entries, and optional local model support.
- Cross-platform installation and automated tests.

- Provide reproducible, versioned plugin ZIPs and SHA-256 files, validate the extracted runtime, and prepare GitHub Release drafts from version tags.
- Reorganize documentation into bilingual entry pages and focused installation, usage, configuration, architecture, and privacy guides.
- Clarify review actions and confirmation, and remove stale version notes and unrelated provider links from plugin metadata.
- Share interface messages between the MCP server and UI, and read the server version from package metadata.
- Check manifest consistency and committed UI output in CI, strengthen the MCP smoke check, and collect environment details in bug reports.
