# 安装与更新

[返回项目首页](../README.zh-CN.md) · [使用指南](./usage.md)

## 安装前准备

- 使用 **Codex 桌面端**，通过插件管理入口直接导入 ZIP；这条路径不需要 Codex CLI。
- 本机安装 **Node.js 20+**，供插件运行本地服务，且桌面端进程能从 PATH 找到 `node`。
- **主会话模型已在本地部署**。插件会请你确认部署位置，但不会下载、部署或切换模型。云端模型是否可用、能否创建子代理由宿主决定。

可在终端检查 Node.js 版本：

```sh
node --version
```

## 获取插件 ZIP

在 [Releases](https://github.com/XHToken/codex-XCoSpan/releases) 下载插件安装包，或直接[下载 v0.1.0 ZIP](https://github.com/XHToken/codex-XCoSpan/releases/download/v0.1.0/codex-local-privacy-router-0.1.0.zip)。**安装只需要 ZIP 文件，SHA-256 校验文件可选。** 仓库保持私有期间，需登录有仓库访问权限的账号下载。

安装包命名为 `codex-local-privacy-router-<version>.zip`，其中 `<version>` 是实际版本号。GitHub 自动生成的 **Source code (zip)** 用于获取源码。开发者也可以按[贡献指南](../CONTRIBUTING.md#build-a-package-locally)在本地生成安装包。

<details>
<summary>可选：校验下载完整性</summary>

如果希望核对 ZIP 是否与发布时一致，可以额外下载同一版本的 `codex-local-privacy-router-<version>.zip.sha256`。它不是安装依赖，也不需要导入 Codex。

用系统的 SHA-256 工具计算 ZIP 摘要，并与校验文件中的值比较：Windows 使用 PowerShell 的 `Get-FileHash -Algorithm SHA256`，macOS 使用 `shasum -a 256`，Linux 使用 `sha256sum`，命令后接 ZIP 路径。

</details>

## 在 Codex 桌面端安装（推荐）

1. 打开 Codex 桌面端的插件管理入口，选择下载的 `codex-local-privacy-router-<version>.zip` 并导入，无需解压。
2. 在插件管理中核对名称 **Edge-Cloud Collaboration** 和版本。安装标识是 `codex-local-privacy-router`，与仓库名 `codex-XCoSpan` 不同。
3. 确认插件及其技能、MCP 服务和 Hooks 已启用，按提示审阅并信任 Hooks，然后**打开新聊天**。

ZIP 已包含构建后的界面和运行文件，不需要 `npm install`、UI 构建、Python 或 Codex CLI。仅把 ZIP 上传到普通聊天不会安装插件。

## 命令行安装（备用）

这条路径需要支持 `plugin` 命令的 Codex CLI，可用于 Windows、macOS 和 Linux。先检查：

```sh
codex plugin --help
```

Windows 通过 npm 安装 Codex 时，若 PowerShell 的执行策略阻止了 `codex.ps1`，可用 `codex.cmd plugin --help` 检查。安装脚本会直接调用原生 `codex.exe` 或 npm 的 Node.js 入口，无需修改执行策略，也不需要 Git Bash 或 WSL。

将 ZIP 解压到**新建的独立目录**。压缩包没有外层文件夹，根目录直接包含 `plugin.json`、`install.mjs`、`.codex-plugin/` 等入口。保留隐藏文件和目录，不要只复制可见文件。

在解压后**包含 `install.mjs` 的目录**打开终端，运行：

```sh
node install.mjs
```

如果已获取项目源码，也可以在仓库根目录运行同一安装命令；修改界面源码后需先重新构建。

脚本把项目复制到 Codex 用户目录下的 `local-plugin-sources/codex-local-privacy-router/`，创建名为 `edge-cloud-collaboration-local` 的专用本地市场并安装插件。Codex 用户目录默认是用户主目录下的 `.codex`；设置 `CODEX_HOME` 时使用其指定位置。脚本不修改其他市场。

使用脚本安装后，通过这个专用市场检查：

```sh
codex plugin list --marketplace edge-cloud-collaboration-local --json
```

列表中应包含插件 ID `codex-local-privacy-router`。在客户端中启用插件及其组件、审阅并信任 Hooks，再打开新聊天。上述专用市场由安装脚本创建，桌面端直接导入后在插件管理中检查即可。

## 更新

下载新版本的 ZIP，在 **Codex 桌面端的插件管理入口导入新版 ZIP**，然后核对插件版本。

使用 CLI 备用路径安装的用户，将新 ZIP 解压到新的独立目录，重新运行 `node install.mjs`，完成插件刷新，并用上述专用市场的列表命令核对版本。不要直接修改安装缓存。

更新后打开新聊天；若列表仍显示旧版本，重启客户端并再次检查。旧聊天中的服务和已有预览不会自动变成新版。企业词表和模型配置应保存在插件目录外，配置方法见[检测配置](./configuration.md)。

## 常见安装问题

| 现象 | 处理 |
| --- | --- |
| 终端或客户端找不到 Node.js | 确认版本至少为 20；修正 PATH 后重启终端和客户端。终端可用不代表已启动的客户端继承了新 PATH。 |
| CLI 备用路径中 `codex plugin --help` 不可用 | 确认 CLI 已安装且支持插件命令。Windows 可先用 `codex.cmd plugin --help` 排除 PowerShell 入口问题；桌面端直接导入无需此命令。 |
| CLI 安装时 Windows 提示 npm 入口缺失 | 修复 Codex 的 npm 安装，或把可用的原生 `codex.exe` 放入 PATH。 |
| 列表有插件，但新聊天没有效果 | 检查插件及其技能、MCP、Hooks 是否启用，Hooks 是否已获信任；重启客户端后打开新聊天。 |
| 能安装，但无法选择云模型或打开对照面板 | 核对宿主的子代理和 MCP Apps 支持，按[使用指南](./usage.md#遇到问题时)处理。 |

装好后按[使用指南](./usage.md)完成首次任务；使用真实材料前阅读[隐私与限制](./privacy.md)。
