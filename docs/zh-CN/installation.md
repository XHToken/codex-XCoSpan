# 安装与更新

[项目首页](../../README.zh-CN.md) · [English](../installation.md)

安装并启用后，可直接在 **插件详情页 → 设置 → 云端模型** 填写并应用配置，或点击 **打开完整设置**。ZIP 导入也使用此入口，不需要运行安装脚本或先进入聊天。兼容范围与旧版客户端入口见[配置说明](configuration.md)。

本指南安装独立的 **Edge-Cloud Collaboration (Exec)**（`codex-local-privacy-router-exec`），Git 市场名为 `codex-xcospan-exec`。它与 main 版本可以同时安装；由于两个版本都会启用自动路由 Hooks，同一聊天请选择一个版本启用。Exec 使用独立的云模型配置，安装后请重新填写；不会自动导入 main 的配置。

## 安装前准备

- 本机安装 **Node.js 20+**，供插件运行本地服务，且客户端进程能从 PATH 找到 `node`。
- 桌面端导入使用 **Codex 桌面端**；命令行安装还需支持 `plugin` 命令的 **Codex CLI**。
- **主会话模型已在本地部署**。插件会请你确认部署位置，但不会下载、部署或切换模型。云端分析需要本机 Codex CLI 及供应商/模型配置，见[配置说明](configuration.md)。

可在终端检查 Node.js 版本：

```sh
node --version
```

## 选择安装方式

| 方式 | 需要准备 | 安装入口 |
| --- | --- | --- |
| Git 插件市场（推荐） | Git、Codex CLI | 添加仓库市场后安装 |
| 桌面端导入 ZIP | Codex 桌面端、插件 ZIP | 插件管理页面的 ZIP 导入入口 |
| 命令行安装 ZIP | Codex CLI、解压后的插件 ZIP | `node install.mjs` |
| 从源码安装 | Git、Codex CLI | 克隆仓库，运行安装脚本 |

四种方式选一种即可，使用下方命令明确指定 `exec` 分支。ZIP 安装请选择已发布的 `exec-v<version>` [版本](https://github.com/XHToken/codex-XCoSpan/releases)中的 `codex-local-privacy-router-exec-<version>.zip`；尚未发布时，可在本分支执行 `npm ci && npm run package` 构建。GitHub 的 **Source code (zip)** 对应源码安装，请选择 Exec 标签或 `exec` 分支。

<details>
<summary>可选：校验下载完整性</summary>

下载同一版本的 `codex-local-privacy-router-exec-<version>.zip.sha256`。

用系统的 SHA-256 工具计算 ZIP 摘要，并与校验文件中的值比较：Windows 使用 PowerShell 的 `Get-FileHash -Algorithm SHA256`，macOS 使用 `shasum -a 256`，Linux 使用 `sha256sum`，命令后接 ZIP 路径。

</details>

## 方式一：Git 插件市场

准备 Git 和支持插件命令的 Codex CLI，在任意目录的终端中运行：

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

第一条命令注册仓库市场，第二条命令安装插件。Codex 自动获取仓库中的插件文件，用户无需手动下载 ZIP、克隆源码或运行安装脚本。

安装后核对状态：

```sh
codex plugin list --marketplace codex-xcospan-exec --json
```

列表中应包含插件 `codex-local-privacy-router-exec`，且 `installed`、`enabled` 为 `true`。在客户端启用技能、MCP 服务和 Hooks，按提示信任 Hooks，然后打开新聊天。

## 方式二：桌面端导入 ZIP

1. 打开 Codex 桌面端的插件管理入口，选择下载的 `codex-local-privacy-router-exec-<version>.zip` 并导入，无需解压。
2. 在插件管理中找到 **Edge-Cloud Collaboration (Exec)**，核对版本并启用。
3. 确认技能、MCP 服务和 Hooks 已启用，按提示审阅并信任 Hooks。
4. 在插件详情页的 **设置 → 云端模型** 填写并点击 **应用配置**，然后打开新聊天使用插件。也可先完成安装，之后再配置云端模型；本地检测不依赖云端配置。

ZIP 已包含构建后的界面和运行文件，可直接导入。

## 方式三：命令行安装 ZIP

适用于 Windows、macOS 和 Linux。先确认 Codex CLI 支持插件命令：

```sh
codex plugin --help
```

Windows 通过 npm 安装 Codex 时，若 PowerShell 阻止了 `codex.ps1`，可改用 `codex.cmd plugin --help`。安装脚本会直接调用原生 `codex.exe` 或 npm 的 Node.js 入口。

将 ZIP 解压到**新建的独立目录**。压缩包没有外层文件夹，根目录直接包含 `plugin.json`、`install.mjs`、`.codex-plugin/` 等入口。保留隐藏文件和目录，不要只复制可见文件。

在解压后**包含 `install.mjs` 的目录**打开终端，运行：

```sh
node install.mjs
```

安装完成后，按下方“验证安装”检查结果。

## 方式四：从源码安装

准备 Git 和支持插件命令的 Codex CLI，在终端运行：

```sh
git clone --branch exec --single-branch https://github.com/XHToken/codex-XCoSpan.git codex-XCoSpan-exec
cd codex-XCoSpan-exec
node install.mjs
```

仓库已包含构建好的界面，可以直接安装。若下载的是 **Source code (zip)**，解压后进入项目根目录，运行 `node install.mjs`。

如果修改了界面源码，先执行 `npm ci` 和 `npm run build:ui`，再运行安装脚本。开发检查与 ZIP 打包见[贡献指南](../../CONTRIBUTING.md)。

## 验证安装

桌面端导入后，在插件管理页面检查名称 **Edge-Cloud Collaboration (Exec)** 和版本。

方式三、四的安装脚本会把插件复制到 Codex 用户目录下的 `local-plugin-sources/codex-local-privacy-router-exec/`，并通过 `edge-cloud-collaboration-exec-local` 本地市场安装。Codex 用户目录默认为 `~/.codex`，也可由 `CODEX_HOME` 指定。用以下命令检查：

```sh
codex plugin list --marketplace edge-cloud-collaboration-exec-local --json
```

列表中应包含插件 `codex-local-privacy-router-exec`，且 `installed`、`enabled` 为 `true`。在客户端检查技能、MCP 服务和 Hooks，按提示信任 Hooks，再打开新聊天。

## 更新

按原安装方式更新：

**Git 插件市场**：刷新仓库并重新安装最新内容。

```sh
codex plugin marketplace upgrade codex-xcospan-exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

其他方式：

- **桌面端导入**：下载新版本 ZIP，通过插件管理入口导入，核对版本。
- **命令行安装 ZIP**：将新版 ZIP 解压到新的独立目录，运行 `node install.mjs`。
- **源码 ZIP 安装**：下载新版源码 ZIP，解压到新的独立目录，运行 `node install.mjs`。
- **Git 克隆安装**：在没有未提交修改的源码目录中运行以下命令；有本地修改时先提交或备份。

```sh
git pull --ff-only
node install.mjs
```

更新后按“验证安装”核对结果并打开新聊天；若仍显示旧版本，重启客户端后检查。企业词表和模型配置保存在插件目录外，见[检测配置](./configuration.md)。

## 常见安装问题

| 现象 | 处理 |
| --- | --- |
| 终端或客户端找不到 Node.js | 确认版本至少为 20；修正 PATH 后重启终端和客户端。终端可用不代表已启动的客户端继承了新 PATH。 |
| `codex plugin --help` 不可用 | 安装或更新支持插件命令的 Codex CLI；也可选择桌面端导入 ZIP。 |
| CLI 安装时 Windows 提示 npm 入口缺失 | 修复 Codex 的 npm 安装，或把可用的原生 `codex.exe` 放入 PATH。 |
| 列表有插件，但新聊天没有效果 | 检查插件及其技能、MCP、Hooks 是否启用，Hooks 是否已获信任；重启客户端后打开新聊天。 |
| 能安装，但无法选择云模型或打开对照面板 | 核对 Codex CLI、云端配置和宿主的 MCP Apps 支持，按[使用指南](./usage.md#遇到问题时)处理。 |

装好后按[使用指南](./usage.md)完成首次任务；使用真实材料前阅读[隐私与限制](./privacy.md)。
