# Changelog

All notable changes to this project are documented here.

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
