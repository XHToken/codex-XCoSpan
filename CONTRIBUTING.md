# Contributing

Thank you for helping improve `codex-XCoSpan`.

## Before opening a pull request

- Read the [README](README.md) and the privacy and routing documentation.
- Keep changes focused and explain the user-visible effect.
- Do not add network calls, telemetry, or cloud handoff paths that bypass the local review and confirmation flow.
- Never include real personal, business, credential, or contract data in source code, tests, fixtures, screenshots, or issue reports.
- Run the checks below from the repository root.

```sh
npm ci
node ./mcp/server.mjs --self-check
npm run build:ui
npm test
```

## Pull requests

Describe the problem, the behavior after the change, the tests you ran, and any compatibility or privacy implications. Keep generated UI output in sync when changing UI sources by running `npm run build:ui`.

Small documentation fixes are welcome. For larger changes, open an issue first so the design and privacy boundary can be discussed before implementation.
