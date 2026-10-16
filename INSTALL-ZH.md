# Edge-Cloud Collaboration 0.1.0

本地与云端模型协作插件：主会话评估任务复杂度和敏感性；简单任务本地处理，复杂的非敏感任务交给云端子代理；敏感材料先在本地脱敏，经用户确认后仅交接脱敏版本。

开发者：iFLYTEK

## 使用环境

- 支持本地插件、stdio MCP、交互式 MCP Apps 和子代理的 Codex 客户端。
- 本机安装 Node.js 20 或更新版本，且 `node` 可从客户端进程的 PATH 找到。
- 同一份 ZIP 适用于 Windows、macOS 和 Linux。Hooks 直接运行 Node.js 文件，不需要 Git Bash、WSL 或 `/bin/sh`。
- 选择云端模型和创建子代理由宿主提供。插件不会部署或下载模型，使用时需按提示确认主会话模型的部署位置。

## 安装

如果目标客户端提供插件 ZIP 导入入口，可选择本 ZIP，并检查导入后的技能、MCP 服务和 Hooks 是否均已启用。不同客户端的导入能力可能不同；仅上传 ZIP 到普通聊天不会安装插件。

没有 ZIP 导入入口时，可以使用随包安装脚本：

1. 解压 ZIP，进入 `codex-local-privacy-router` 文件夹。
2. 确认 `node --version` 可运行，并已安装支持 `plugin` 命令的 Codex CLI。Windows 通过 npm 安装时，可用 `codex.cmd plugin --help` 检查，避免 PowerShell 优先选择受执行策略限制的 `.ps1` 入口。
3. 在该文件夹打开终端（Windows 使用 PowerShell 或命令提示符），运行：

```sh
node install.mjs
```

Windows 使用原生 `codex.exe` 或 npm 安装的 Codex CLI；不需要修改 PowerShell 执行策略。脚本会复制运行文件到 Codex 用户目录下独立的 `local-plugin-sources/codex-local-privacy-router` 目录，创建专用本地市场，再通过 `codex plugin marketplace add` 和 `codex plugin add` 安装。不会修改已有的其他市场。运行 `node install.mjs --help` 可查看说明。

4. 按宿主要求审阅并信任 Hooks，然后打开新聊天使用插件。若插件列表未刷新，重启客户端。

也可以让 Codex 读取本目录并请求：“请按 README 安装这个本地插件。”

## 本版脱敏能力

默认开箱使用本地规则与 Codex 本地主会话语义复核，不需要另行安装 Python 或模型服务。支持企业词表和自定义规则；密钥、身份号码、通过校验的银行卡等默认强制保护，金额、日期、公司名称由主会话结合具体任务复核。检测异常会阻止交接，已确认后修改内容需要重新确认。可选独立本地模型和词表配置见包内 `DETECTION-ZH.md`。

## 使用

启用后可提及 Edge-Cloud Collaboration 并提交任务。首次使用按提示确认本地主会话部署；需要时选择云端大模型。敏感任务先查看脱敏对照，再点击“确认并继续”。确认后的聊天提示简化为“已确认脱敏内容，请交给子代理继续分析。”；支持上下文传递的宿主会在内部保留预览编号，仅在旧接口不支持或写入失败时显示编号。确认只是保存授权并通知主会话，随后才会生成交接包、创建子代理并等待分析结果。

脱敏校验是本地规则检查，不能独立保证语义安全或分析材料足够完整。预览、确认、交接与分析完成是不同阶段；部分调度行为仍依赖模型遵循插件指令。

## 包内文件

包含标准 `plugin.json` / `mcp.json`、Codex 兼容清单、Hooks、技能、MCP 服务、已构建的交互界面及其运行依赖。运行时不需要 `npm install` 或构建界面。未包含用户材料、配置、账号凭据、历史会话或 `node_modules`。

本包是 0.1.0 运行版，61 项自动测试通过，包含规则、企业词表及可选本地模型检测；运行时仅需要 Node.js，无需 Python。Windows 的 CLI 解析分支、空格/中文路径和安装目录准备已通过自动测试；MCP、界面与 Hooks 在 macOS 上完成回归验证。尚未在原生 Windows 机器或其他用户的真实云端模型环境中实测。

## 官方安装参考

- [OpenAI 插件打包与本地市场说明](https://developers.openai.com/plugins/build/plugins)
- [本地 MCP 与桌面执行要求](https://developers.openai.com/plugins/deploy/desktop-only)
