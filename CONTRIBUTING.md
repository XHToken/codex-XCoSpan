# Contributing

Read the [architecture](docs/architecture.md), [privacy boundary](docs/privacy.md), and [routing reference](skills/privacy-routing/references/routing-policy.md) before changing the workflow. Use synthetic data in code, tests, screenshots, and reports; never include real confidential material or credentials.

## Find the right file

| Change | Main location | Check |
| --- | --- | --- |
| Task assessment or detection | `mcp/routing.mjs`, `mcp/detection*.mjs` | Detection and routing tests |
| Review state, consent, or MCP tools | `mcp/server.mjs` | Routing/redaction tests and MCP smoke check |
| Hook behavior or agent instructions | `hooks/`, `skills/privacy-routing/` | Platform and routing tests |
| Review interface | `ui/src/review.js`, `ui/review.template.html` | Rebuild HTML and run browser tests |
| Shared UI/server wording | `shared/messages.mjs` | Rebuild HTML and run the full suite |
| Installation or metadata | `install.mjs`, plugin/MCP manifests | Manifest check and platform tests |
| User documentation | `README*.md`, `docs/` | Follow the instructions and check relative links |

## Build and verify

Use Node.js 20+ and run these commands from the root of a source checkout:

```sh
npm ci
npm run check:manifests
npm run build:ui
npm run smoke:mcp
npm test
```

Browser tests use installed Google Chrome. Install it with `npx playwright install chrome` if needed, or set `PLAYWRIGHT_CHROME` to a compatible browser executable. CI installs Chrome explicitly.

Edit UI sources, then commit the rebuilt `ui/contract-redaction-review.html` with them. CI rebuilds it and rejects a mismatch with the committed file. `smoke:mcp` starts the service from another working directory and verifies its advertised tools and UI resource.

## Documentation ownership

- README files introduce the project, installation, and everyday use. Keep the English and Chinese entry points aligned.
- `docs/` contains the detailed user and maintainer guides; the current guides are in Chinese.
- `SKILL.md` contains agent execution instructions. Its routing reference contains protocol details and invariants. Do not remove authorization checks merely because a user guide also describes them.
- Keep historical changes in `CHANGELOG.md`, rather than versioned feature sections or fixed test counts in user guides.

## Build a package locally

Clone the repository or extract **Source code (zip)**, then run these commands from its root:

```sh
npm ci
npm run package
npm run check:package
```

`package` runs `build:ui` and `check:manifests`, then creates `dist/codex-local-privacy-router-<version>.zip` and the matching `.zip.sha256` checksum. `check:package` extracts the ZIP and verifies that its runtime works without installing npm dependencies.

The ZIP contains the built UI and runtime files at its root. See the [installation guide](docs/installation.md) for installation and update steps.

## Publish a release

1. Set the version in `package.json`, the lockfile, and both plugin manifests; add a changelog entry. Run the build/test checks above, build and verify the package, and commit the rebuilt UI.
2. Push a `v<version>` tag matching that reviewed commit and package version, for example `v0.1.0` for version `0.1.0`. The `release.yml` workflow runs the tests and creates a **draft GitHub Release** containing the plugin ZIP and checksum.
3. Review the draft and its attachments, then publish it manually. Present the named plugin ZIP as the download users need for installation; label the checksum as optional integrity verification. GitHub's automatic **Source code (zip)** remains a source archive.

To build on GitHub without creating a Release, run the same workflow manually with `workflow_dispatch` and download its Actions artifact. A manual run does not create or publish a Release.

Keep the installation ID, existing entry paths, and UI resource URI stable. If they change, document migration steps and update every consumer. Add project website/privacy/terms links to both manifests only when the project has real published destinations; host-provider policies are not substitutes for this plugin's documentation.

## Pull requests

Describe the problem, resulting behavior, validation, and any compatibility or privacy implications. New external calls or cloud paths must preserve the documented data boundary and sensitive-content approval flow. For larger changes, discuss the design in an issue first. Documentation-only changes do not require browser tests.

## Cloud execution checks

`npm test` uses an isolated fake CLI and synthetic credentials for cloud execution, authorization, failures and settings UI tests. Run `npm run check:cloud-cli` with a local Codex CLI to verify the real Responses request, selected model, built-in tool exposure, shell execution, loopback networking, writes outside the worker directory and tool-result round trips against a synthetic local service. This check does not call a cloud provider. The CLI integration was verified with `codex-cli 0.162.1`; repeat it when upgrading the CLI because feature gates can change.
