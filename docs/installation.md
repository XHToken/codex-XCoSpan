# Installation and updates

[Project home](../README.md) · [简体中文](zh-CN/installation.md)

After installation and enablement, configure the model under **Plugin details → Settings → Cloud model**, or choose **Open settings**. ZIP imports use the same entrypoint; no installer script or chat is required for configuration. See [configuration](configuration.md) for compatibility and older-client alternatives.

This guide installs **Edge-Cloud Collaboration (Exec)** (`codex-local-privacy-router-exec`), independently of the main version. The Git marketplace is `codex-xcospan-exec`. Both versions can be installed, but enable only one per chat because each adds automatic routing Hooks. Exec has separate cloud settings; configure them after installation. Existing main-version settings are not imported automatically.

## Prerequisites

- Install **Node.js 20+** to run the plugin's local service. The client process must be able to find `node` on its PATH.
- ZIP import requires the **Codex desktop app**. Command-line installation also requires a **Codex CLI** that supports `plugin` commands.
- **Run the main chat model locally.** The plugin asks you to confirm its deployment location but does not download, deploy, or switch models. Cloud analysis requires a local Codex CLI and a configured provider/model; see [configuration](configuration.md).

Check your Node.js version in a terminal:

```sh
node --version
```

## Choose an installation method

| Method | Requirements | Installation entry point |
| --- | --- | --- |
| Git plugin marketplace (recommended) | Git, Codex CLI | Register the repository marketplace, then install the plugin |
| Desktop ZIP import | Codex desktop app, plugin ZIP | ZIP import in plugin management |
| Command-line ZIP installation | Codex CLI, extracted plugin ZIP | `node install.mjs` |
| Installation from source | Git, Codex CLI | Clone the repository and run the installer |

Choose one method. Install `exec` explicitly with the commands below. For ZIP installation, select `codex-local-privacy-router-exec-<version>.zip` from an `exec-v<version>` [release](https://github.com/XHToken/codex-XCoSpan/releases), when published, or build it on this branch with `npm ci && npm run package`. GitHub’s **Source code (zip)** requires the source installation method; select an Exec tag or the `exec` branch.

<details>
<summary>Optional: verify download integrity</summary>

Download `codex-local-privacy-router-exec-<version>.zip.sha256` for the same version.

Compute the ZIP's SHA-256 hash and compare it with the checksum file. Use PowerShell's `Get-FileHash -Algorithm SHA256` on Windows, `shasum -a 256` on macOS, or `sha256sum` on Linux, followed by the ZIP path.

</details>

## Method 1: Git plugin marketplace

With Git and a Codex CLI that supports plugin commands installed, run these commands from any directory:

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

The first command registers the repository marketplace; the second installs the plugin. Codex retrieves the plugin files automatically, so there is no need to download a ZIP, clone the source, or run the installer manually.

Check the installation:

```sh
codex plugin list --marketplace codex-xcospan-exec --json
```

The list should contain `codex-local-privacy-router-exec` with both `installed` and `enabled` set to `true`. Enable its skills, MCP service, and Hooks in the client, trust the Hooks when prompted, and open a new chat.

## Method 2: Desktop ZIP import

1. Open plugin management in Codex desktop and import the downloaded `codex-local-privacy-router-exec-<version>.zip` without extracting it.
2. Find **Edge-Cloud Collaboration (Exec)**, check its version, and enable it.
3. Confirm that its skills, MCP service, and Hooks are enabled. Review and trust the Hooks when prompted.
4. In the plugin detail page, fill in **Settings → Cloud model** and click **Apply settings**, then open a new chat. You can also configure the cloud model later; local detection does not require cloud settings.

The ZIP includes the built interface and runtime files, ready for import.

## Method 3: Command-line ZIP installation

Supported on Windows, macOS, and Linux. First check that your Codex CLI supports plugin commands:

```sh
codex plugin --help
```

On Windows, if PowerShell blocks `codex.ps1` from an npm installation, use `codex.cmd plugin --help`. The installer calls the native `codex.exe` or npm's Node.js entry point directly.

Extract the ZIP into a **new, dedicated directory**. The archive has no enclosing folder: `plugin.json`, `install.mjs`, `.codex-plugin/`, and other entry points are at its root. Preserve hidden files and directories.

Open a terminal in the extracted directory **containing `install.mjs`**, then run:

```sh
node install.mjs
```

Follow “Verify the installation” below to check the result.

## Method 4: Installation from source

With Git and a Codex CLI that supports plugin commands installed, run:

```sh
git clone --branch exec --single-branch https://github.com/XHToken/codex-XCoSpan.git codex-XCoSpan-exec
cd codex-XCoSpan-exec
node install.mjs
```

The repository includes the built interface and can be installed directly. If you downloaded **Source code (zip)**, extract it, open the project root, and run `node install.mjs`.

If you modify the interface source, run `npm ci` and `npm run build:ui` before running the installer. See the [contributing guide](../CONTRIBUTING.md) for development checks and ZIP packaging.

## Verify the installation

After desktop import, check the name **Edge-Cloud Collaboration (Exec)** and its version in plugin management.

The installer used by methods 3 and 4 copies the plugin to `local-plugin-sources/codex-local-privacy-router-exec/` under the Codex user directory, then installs it through the `edge-cloud-collaboration-exec-local` marketplace. The Codex user directory defaults to `~/.codex` and can be set with `CODEX_HOME`. Check it with:

```sh
codex plugin list --marketplace edge-cloud-collaboration-exec-local --json
```

The list should contain `codex-local-privacy-router-exec` with both `installed` and `enabled` set to `true`. Check its skills, MCP service, and Hooks in the client, trust the Hooks when prompted, and open a new chat.

## Updates

Use the same method you used to install the plugin.

**Git plugin marketplace:** refresh the repository and reinstall its latest contents.

```sh
codex plugin marketplace upgrade codex-xcospan-exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

For other methods:

- **Desktop import:** download the new ZIP, import it through plugin management, and check the version.
- **Command-line ZIP installation:** extract the new ZIP into a new, dedicated directory and run `node install.mjs`.
- **Source ZIP installation:** download the new source ZIP, extract it into a new, dedicated directory, and run `node install.mjs`.
- **Git clone installation:** run the following commands from a source directory with no uncommitted changes. Commit or back up local changes first.

```sh
git pull --ff-only
node install.mjs
```

Follow “Verify the installation” and open a new chat. If the old version still appears, restart the client and check again. Keep enterprise dictionaries and model configuration outside the plugin directory; see [Detection configuration](./configuration.md).

## Installation troubleshooting

| Symptom | Action |
| --- | --- |
| The terminal or client cannot find Node.js | Check that Node.js is version 20 or later. Fix PATH, then restart the terminal and client. An already running client may not have inherited the updated PATH. |
| `codex plugin --help` is unavailable | Install or update to a Codex CLI with plugin commands, or use desktop ZIP import. |
| Command-line installation on Windows reports a missing npm entry point | Repair the Codex npm installation, or add a working native `codex.exe` to PATH. |
| The plugin appears in the list but has no effect in a new chat | Check that the plugin, skills, MCP service, and Hooks are enabled and that the Hooks are trusted. Restart the client and open a new chat. |
| Installation succeeds, but cloud model selection or the comparison panel is unavailable | Check Codex CLI, cloud configuration, and the host's MCP Apps support, then follow the [usage guide](./usage.md#troubleshooting). |

Follow the [usage guide](./usage.md) for your first task. Read [Privacy and data flow](./privacy.md) before using real material.
