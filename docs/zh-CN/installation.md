# 安装与更新

[项目首页](../../README.zh-CN.md) · [English](../installation.md)

## 安装前先选择分支

`main` 版本使用 Codex 原生 subagent，目前与主会话共用模型供应商。要组合本地主会话模型与云端 subagent，需借助第三方网关统一供应商入口（provider/base URL），并将两类模型统一适配为 Responses API。请先完成[模型接入配置](configuration.md#模型供应商与-api-协议)，安装插件不会自动提供网关。

如果主会话与云端分析需要不同供应商，请使用下方的 [Exec 替代方案](#安装-exec-替代方案)。它通过独立 Codex 进程执行云端分析，但两侧模型端点仍须兼容 Responses API。

## 安装前准备

- 本机安装 **Node.js 20+**，供插件运行本地服务，且客户端进程能从 PATH 找到 `node`。
- 桌面端导入使用 **Codex 桌面端**；命令行安装还需支持 `plugin` 命令的 **Codex CLI**。
- **主会话模型已在本地部署**。插件会请你确认部署位置，但不会下载、部署或切换模型。云端模型是否可用、能否创建子代理由宿主决定。

可在终端检查 Node.js 版本：

```sh
node --version
```

## 安装 Exec 替代方案

需要主会话与云端进程分别使用不同供应商时，可直接从 `exec` 安装：

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref exec
codex plugin add codex-local-privacy-router-exec@codex-xcospan-exec
```

客户端显示为 **Edge-Cloud Collaboration (Exec)**。独立的 `codex exec` 进程使用 Exec 插件详情页中配置的供应商和模型；主会话与独立进程的端点均须直接支持或经适配提供 Responses API。请分别完成配置，同一聊天只启用一个插件版本，避免路由 Hooks 重复运行。

源码安装、ZIP、配置和更新方式见 [Exec 安装指南](https://github.com/XHToken/codex-XCoSpan/blob/exec/docs/zh-CN/installation.md)。下方四种方式安装的是 main 版本。两个分支独立迭代，安装 Exec 不需要将 main 合并到该分支。

## 选择安装方式

| 方式 | 需要准备 | 安装入口 |
| --- | --- | --- |
| Git 插件市场（推荐） | Git、Codex CLI | 添加仓库市场后安装 |
| 桌面端导入 ZIP | Codex 桌面端、插件 ZIP | 插件管理页面的 ZIP 导入入口 |
| 命令行安装 ZIP | Codex CLI、解压后的插件 ZIP | `node install.mjs` |
| 从源码安装 | Git、Codex CLI | 克隆仓库，运行安装脚本 |

四种方式选一种即可。ZIP 安装包从 [Releases](https://github.com/XHToken/codex-XCoSpan/releases) 获取，也可直接[下载 v0.1.0 ZIP](https://github.com/XHToken/codex-XCoSpan/releases/download/v0.1.0/codex-local-privacy-router-0.1.0.zip)。选择 `codex-local-privacy-router-<version>.zip`；GitHub 的 **Source code (zip)** 对应源码安装。

<details>
<summary>可选：校验下载完整性</summary>

下载同一版本的 `codex-local-privacy-router-<version>.zip.sha256`。

用系统的 SHA-256 工具计算 ZIP 摘要，并与校验文件中的值比较：Windows 使用 PowerShell 的 `Get-FileHash -Algorithm SHA256`，macOS 使用 `shasum -a 256`，Linux 使用 `sha256sum`，命令后接 ZIP 路径。

</details>

## 方式一：Git 插件市场

准备 Git 和支持插件命令的 Codex CLI，在任意目录的终端中运行：

```sh
codex plugin marketplace add XHToken/codex-XCoSpan --ref main
codex plugin add codex-local-privacy-router@codex-xcospan
```

第一条命令注册仓库市场，第二条命令安装插件。Codex 自动获取仓库中的插件文件，用户无需手动下载 ZIP、克隆源码或运行安装脚本。

安装后核对状态：

```sh
codex plugin list --marketplace codex-xcospan --json
```

列表中应包含插件 `codex-local-privacy-router`，且 `installed`、`enabled` 为 `true`。在客户端启用技能、MCP 服务和 Hooks，按提示信任 Hooks，然后打开新聊天。

## 方式二：桌面端导入 ZIP

1. 打开 Codex 桌面端的插件管理入口，选择下载的 `codex-local-privacy-router-<version>.zip` 并导入，无需解压。
2. 在插件管理中找到 **Edge-Cloud Collaboration**，核对版本并启用。
3. 确认技能、MCP 服务和 Hooks 已启用，按提示审阅并信任 Hooks，然后**打开新聊天**。

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
git clone --branch main --single-branch https://github.com/XHToken/codex-XCoSpan.git
cd codex-XCoSpan
node install.mjs
```

仓库已包含构建好的界面，可以直接安装。若下载的是 **Source code (zip)**，解压后进入项目根目录，运行 `node install.mjs`。

如果修改了界面源码，先执行 `npm ci` 和 `npm run build:ui`，再运行安装脚本。开发检查与 ZIP 打包见[贡献指南](../../CONTRIBUTING.md)。

## 验证安装

桌面端导入后，在插件管理页面检查名称 **Edge-Cloud Collaboration** 和版本。

方式三、四的安装脚本会把插件复制到 Codex 用户目录下的 `local-plugin-sources/codex-local-privacy-router/`，并通过 `edge-cloud-collaboration-local` 本地市场安装。Codex 用户目录默认为 `~/.codex`，也可由 `CODEX_HOME` 指定。用以下命令检查：

```sh
codex plugin list --marketplace edge-cloud-collaboration-local --json
```

列表中应包含插件 `codex-local-privacy-router`，且 `installed`、`enabled` 为 `true`。在客户端检查技能、MCP 服务和 Hooks，按提示信任 Hooks，再打开新聊天。

## 更新

按原安装方式更新：

**Git 插件市场**：刷新仓库并重新安装最新内容。

```sh
codex plugin marketplace upgrade codex-xcospan
codex plugin add codex-local-privacy-router@codex-xcospan
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
| 能安装，但无法选择云模型或打开对照面板 | 核对宿主的子代理和 MCP Apps 支持，按[使用指南](./usage.md#遇到问题时)处理。 |

装好后按[使用指南](./usage.md)完成首次任务；使用真实材料前阅读[隐私与限制](./privacy.md)。
