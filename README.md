# codex-XCoSpan · Exec

[![CI](https://github.com/XHToken/codex-XCoSpan/actions/workflows/ci.yml/badge.svg?branch=exec)](https://github.com/XHToken/codex-XCoSpan/actions/workflows/ci.yml?query=branch%3Aexec)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-7289da?logo=discord&logoColor=white)](https://discord.gg/yxesrcfy7)

[English](README.md) · [简体中文](README.zh-CN.md)

A Codex plugin that coordinates a locally deployed main-session model with cloud analysis. Simple work stays local; complex sensitive material is redacted and reviewed by you before the plugin runs cloud analysis through `codex exec`.

The plugin appears as **Edge-Cloud Collaboration (Exec)**. Its installation ID is `codex-local-privacy-router-exec`.

This branch evolves independently of `main`. It uses its own plugin, marketplace, MCP service, skill and cloud settings (`~/.codex/privacy-router-exec/cloud.json`). Installations can coexist; enable one version per chat to avoid applying two routing workflows. Configure the Exec cloud model separately after installation.

See the [current architecture and flow](docs/architecture.md).

## Before you start

- Install Node.js 20+ to run the plugin's local service.
- Use the Codex desktop app. Command-line installation also requires a Codex CLI with `plugin` commands.
- Configure a locally deployed main-session model **before submitting private material**. Installing this plugin does not install a model, change where your chat runs, or make an existing cloud chat local.

## Install

Install the `exec` branch using the Git marketplace or source commands below. For ZIP installation, use an Exec package named `codex-local-privacy-router-exec-<version>.zip` from an `exec-v<version>` [release](https://github.com/XHToken/codex-XCoSpan/releases), when published, or build one with `npm ci && npm run package`.

Choose one installation method:

| Method | Best for | Steps |
| --- | --- | --- |
| Git marketplace (recommended) | Letting Codex fetch and install the plugin | Add the repository marketplace and install the plugin |
| Desktop ZIP import | Installing a released version through the desktop app | Download the ZIP and import it through plugin management |
| Command-line ZIP installation | Terminal users or clients without a ZIP import option | Extract the ZIP and run `node install.mjs` |
| Install from source | Modifying the plugin or using the repository version | Clone the repository and run the installer |

### Option 1: Git marketplace

With Git, Node.js 20+, and a Codex CLI with plugin commands installed, run:

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

Codex fetches the repository and installs the plugin automatically. No manual ZIP download or source checkout is needed. Enable **Edge-Cloud Collaboration (Exec)** in your client, review and trust its Hooks when prompted, and start a new chat.

### Option 2: Desktop ZIP import

1. Obtain `codex-local-privacy-router-exec-<version>.zip` from an Exec release or build it from this branch as described above.
2. Open plugin management in Codex desktop and select the file through its ZIP import option. The ZIP includes the built UI and runtime files; leave it compressed.
3. Enable **Edge-Cloud Collaboration (Exec)**, review and trust its Hooks when prompted, then start a new chat.

### Option 3: Command-line ZIP installation

Check that your Codex CLI supports plugin commands:

```sh
codex plugin --help
```

Extract the complete plugin ZIP into a dedicated directory, keeping hidden entries such as `.codex-plugin/`. Open a terminal in the directory containing `install.mjs` and run:

```sh
node install.mjs
```

The script copies the plugin, registers a local marketplace, and installs it. Enable the plugin in your client, trust its Hooks, and start a new chat.

### Option 4: Install from source

With Git, Node.js 20+, and a Codex CLI with plugin commands installed, run:

```sh
git clone --branch exec --single-branch https://github.com/XHToken/codex-XCoSpan.git codex-XCoSpan-exec
cd codex-XCoSpan-exec
node install.mjs
```

The repository includes the built UI. Enable the plugin in your client, trust its Hooks, and start a new chat. To modify and rebuild the UI or create a distributable ZIP, see [Contributing](CONTRIBUTING.md). For verification, updates, and troubleshooting, see the [installation guide](docs/installation.md).

## Use it

Submit your task normally. You can mention **Edge-Cloud Collaboration (Exec)** in the first request; once its Hooks are active, you do not need to repeat the name on every turn.

> Use Edge-Cloud Collaboration (Exec) to compare the risks in this synthetic supplier proposal. Show me the redacted version before any cloud analysis.

| Your task | What to expect |
| --- | --- |
| Simple work | The local main session answers directly. |
| Complex work using non-sensitive material | MCP runs `codex exec` using your saved provider/model. No redaction review is needed. |
| Complex work containing sensitive material | The main session creates a local redaction preview and waits for your confirmation. |

After installation and enablement, use **Plugin details → Settings → Cloud model** to enter your provider/model and choose **Apply settings**, or use **Open settings**. No chat is needed to configure the model. On first use, confirm where the main-session model runs. Cloud analysis requires a local Codex CLI and authentication; see [configuration](docs/configuration.md). This choice is separate from approving a redacted document.

For a redaction review, select **Compare redaction**, check the full text, and mask anything missed. Choose **Confirm and continue** to authorize that version, or **Reject and stop** to stop the handoff. Confirmation saves your decision; the main session then dispatches the analysis and returns the result. Changed content needs another review. To keep a task local, say: “Handle this task locally; do not use cloud analysis.”

The [usage guide](docs/usage.md) walks through examples, corrections, confirmation, and recovery when a preview expires or the UI cannot resume the chat.

## Privacy boundary

The default detector runs offline. An optional configured detection service receives original text chunks. Cloud analysis through the sensitive workflow receives the confirmed redacted material and checked task instructions. The plugin does not control unrelated host tools or the host's own storage, and redaction can miss sensitive meaning. Read the [data flow and limitations](docs/privacy.md).

## Documentation and development

| Document | Purpose |
| --- | --- |
| [Installation](docs/installation.md) · [Usage](docs/usage.md) | Setup and everyday operation |
| [Configuration](docs/configuration.md) | Cloud provider/model, dictionary, rules, and detection service |
| [Architecture](docs/architecture.md) | Modules, workflow, and compatibility entry points |
| [Contributing](CONTRIBUTING.md) | Build, test, and release checks |
| [Routing reference](skills/privacy-routing-exec/references/routing-policy.md) | Agent-facing protocol and authorization rules |
| [Security](SECURITY.md) · [Changelog](CHANGELOG.md) | Vulnerability reporting and release history |

## Community

Join our [Discord](https://discord.gg/yxesrcfy7) for discussion, report bugs or suggest features in [GitHub Issues](https://github.com/XHToken/codex-XCoSpan/issues), and visit the [XHToken community](https://github.com/XHToken/community) to get involved.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in the [Security Policy](SECURITY.md).

Licensed under the [Apache License 2.0](LICENSE).
