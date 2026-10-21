# codex-XCoSpan

[![CI](https://github.com/XHToken/codex-XCoSpan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XHToken/codex-XCoSpan/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/XHToken/codex-XCoSpan)](https://github.com/XHToken/codex-XCoSpan/releases/latest)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-XHToken%20community-green)](https://github.com/XHToken/community/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-7289da?logo=discord&logoColor=white)](https://discord.gg/yxesrcfy7)

[English](README.md) · [简体中文](README.zh-CN.md)

A Codex plugin that coordinates a locally deployed main-session model with cloud analysis. Simple work stays local; complex sensitive material is redacted and reviewed by you before the plugin prepares a cloud handoff.

The plugin appears as **Edge-Cloud Collaboration**. Its installation ID is `codex-local-privacy-router`.

![codex-XCoSpan architecture: local task routing, redaction and human review, cloud analysis, and local delivery](assets/architecture.webp)

## Model providers and branch choice

> **The `main` version uses native Codex subagents, which currently inherit the main session's model provider. Choosing a different model does not select a different provider.**

To use a local main-session model and a cloud subagent on `main`, first use a third-party gateway to expose both through **one provider/base URL**, route by model ID, and adapt both backends to the **Responses API**. The plugin does not include this gateway or convert model protocols. See [model connection requirements](docs/configuration.md#model-providers-and-api-protocol).

| Branch | Cloud analysis | Model connection |
| --- | --- | --- |
| `main` | Native Codex subagent | Main session and subagent share one provider; a gateway routes local/cloud models and exposes Responses API compatibility. |
| [`exec`](https://github.com/XHToken/codex-XCoSpan/tree/exec) | A separate `codex exec` process | Main session and worker may use different providers/base URLs; each model endpoint must still support the Responses API, directly or through an adapter. |

For the independent-process option, install the Exec plugin:

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

It appears as **Edge-Cloud Collaboration (Exec)**. Configure its cloud provider/model separately and enable one version per chat. Full steps are in the [Exec installation guide](https://github.com/XHToken/codex-XCoSpan/blob/exec/docs/installation.md).

## Before you start

- Install Node.js 20+ to run the plugin's local service.
- Use the Codex desktop app. Command-line installation also requires a Codex CLI with `plugin` commands.
- Connect local and cloud models through a shared Responses-compatible gateway for `main`, or choose the Exec version above.
- Configure a locally deployed main-session model **before submitting private material**. Installing this plugin does not install a model, change where your chat runs, or make an existing cloud chat local.

## Install

**[Download plugin ZIP · v0.1.0](https://github.com/XHToken/codex-XCoSpan/releases/download/v0.1.0/codex-local-privacy-router-0.1.0.zip)** · [All releases](https://github.com/XHToken/codex-XCoSpan/releases)

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
codex plugin marketplace add XHToken/codex-XCoSpan --ref main
codex plugin add codex-local-privacy-router@codex-xcospan
```

Codex fetches the repository and installs the plugin automatically. No manual ZIP download or source checkout is needed. Enable **Edge-Cloud Collaboration** in your client, review and trust its Hooks when prompted, and start a new chat.

### Option 2: Desktop ZIP import

1. Download `codex-local-privacy-router-0.1.0.zip` using the link above.
2. Open plugin management in Codex desktop and select the file through its ZIP import option. The ZIP includes the built UI and runtime files; leave it compressed.
3. Enable **Edge-Cloud Collaboration**, review and trust its Hooks when prompted, then start a new chat.

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
git clone --branch main --single-branch https://github.com/XHToken/codex-XCoSpan.git
cd codex-XCoSpan
node install.mjs
```

The repository includes the built UI. Enable the plugin in your client, trust its Hooks, and start a new chat. To modify and rebuild the UI or create a distributable ZIP, see [Contributing](CONTRIBUTING.md). For verification, updates, and troubleshooting, see the [installation guide](docs/installation.md).

## Use it

Submit your task normally. You can mention **Edge-Cloud Collaboration** in the first request; once its Hooks are active, you do not need to repeat the name on every turn.

> Use Edge-Cloud Collaboration to compare the risks in this synthetic supplier proposal. Show me the redacted version before any cloud analysis.

| Your task | What to expect |
| --- | --- |
| Simple work | The local main session answers directly. |
| Complex work using non-sensitive material | The main session selects an eligible cloud model and delegates the analysis. No redaction review is needed. |
| Complex work containing sensitive material | The main session creates a local redaction preview and waits for your confirmation. |

On first use, confirm where the main-session model runs. When several eligible cloud models are available, choose one; this choice is separate from approving a redacted document.

For a redaction review, select **Compare redaction**, check the full text, and mask anything missed. Choose **Confirm and continue** to authorize that version, or **Reject and stop** to stop the handoff. Confirmation saves your decision; the main session then dispatches the analysis and returns the result. Changed content needs another review. To keep a task local, say: “Handle this task locally; do not use cloud analysis.”

The [usage guide](docs/usage.md) walks through examples, corrections, confirmation, and recovery when a preview expires or the UI cannot resume the chat.

## Privacy boundary

The default detector runs offline. An optional configured detection service receives original text chunks. Cloud analysis through the sensitive workflow receives the confirmed redacted material and checked task instructions. The plugin does not control unrelated host tools or the host's own storage, and redaction can miss sensitive meaning. Read the [data flow and limitations](docs/privacy.md).

## Documentation and development

| Document | Purpose |
| --- | --- |
| [Installation](docs/installation.md) · [Usage](docs/usage.md) | Setup and everyday operation |
| [Configuration](docs/configuration.md) | Model providers, Responses API requirements, optional dictionary, rules, and detection service |
| [Architecture](docs/architecture.md) | Modules, workflow, and compatibility entry points |
| [Contributing](CONTRIBUTING.md) | Build, test, and release checks |
| [Routing reference](skills/privacy-routing/references/routing-policy.md) | Agent-facing protocol and authorization rules |
| [Security](SECURITY.md) · [Changelog](CHANGELOG.md) | Vulnerability reporting and release history |

Licensed under the [XHToken community license (Apache-2.0)](LICENSE).
