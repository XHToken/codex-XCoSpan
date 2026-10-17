# codex-XCoSpan

[English](README.md) · [简体中文](README.zh-CN.md)

让本地主会话模型与云端分析模型协作的 Codex 插件：简单任务留在本地；复杂任务涉及敏感材料时，先在本地脱敏，由你确认后再准备云端交接。

客户端显示名称为 **Edge-Cloud Collaboration**，安装标识为 `codex-local-privacy-router`。

![codex-XCoSpan 架构：本地任务分流、脱敏与人工审阅、云端分析及本地交付](assets/architecture.zh-CN.png)

## 使用前准备

- 使用 Codex 桌面端直接导入插件 ZIP。
- 本机安装 Node.js 20+，供桌面端运行插件的本地服务。桌面端导入 ZIP 不需要 Codex CLI。
- **提交私密材料前，先在宿主中配置本地部署的主会话模型。** 安装本插件不会部署模型、切换当前模型，也不会把已有的云端聊天变成本地聊天。

## 安装

版本发布后，在本仓库的 **Releases** 页下载 `codex-local-privacy-router-<version>.zip`。**安装只需要 ZIP 文件**，`.zip.sha256` 校验文件可选，用于核对下载完整性。GitHub 自动提供的 **Source code (zip)** 是源码归档。需要自行生成安装包时，见[贡献指南](CONTRIBUTING.md#build-a-package-locally)。

**推荐在 Codex 桌面端直接导入 ZIP：**

1. 打开桌面端的插件管理入口，选择下载的插件 ZIP 并导入。
2. 核对安装后的名称 **Edge-Cloud Collaboration** 和版本，启用插件，按提示审阅并信任 Hooks。
3. 打开新聊天使用。

ZIP 已包含构建好的界面和运行文件，桌面端导入无需解压、`npm install` 或 Python。把 ZIP 上传到普通聊天不会安装插件。命令行备用方式是解压到独立目录后运行 `node install.mjs`；只有这条路径需要支持插件命令的 Codex CLI。校验、更新与 CLI 备用方式见[安装指南](docs/installation.md)。

## 怎么使用

直接用自然语言提交任务即可。首次可以提及 **Edge-Cloud Collaboration**；Hooks 正常启用后，后续消息不需要反复点名插件。

> 请使用 Edge-Cloud Collaboration 分析这份虚构的供应商方案，比较履约风险。如需云端分析，请先让我确认脱敏版本。

| 任务类型 | 你会看到什么 |
| --- | --- |
| 简单任务 | 本地主会话直接回答。 |
| 复杂、非敏感任务 | 选择可用的云端模型后交给子代理分析，无需脱敏确认。 |
| 复杂、敏感任务 | 先生成本地脱敏预览，等待你确认。 |

首次使用时按提示确认主会话的实际部署位置。有多个合适的云端模型时，再选择使用哪一个；**选择模型与确认脱敏内容是两件事**。

出现预览后，点击“**查看脱敏对照**”核对全文，补充遮蔽遗漏的敏感内容；同意后点击“**确认并继续**”，不同意则点击“**拒绝并停止**”。确认保存授权后，主会话才会调度云端分析并返回结果。材料修改后需要重新确认。

如果只希望本地处理，直接说：“**这次只在本地完成，不要使用云端分析。**”

完整示例、误遮蔽修正、预览过期和确认后未继续的处理方式见[使用指南](docs/usage.md)。

## 隐私边界

默认规则检测离线运行；可选的独立检测服务会接收原文分块。敏感工作流只向云端分析交接已确认的脱敏材料和检查后的任务说明。插件不能控制宿主的其他工具或记录方式，脱敏也可能漏掉敏感语义。详见[数据流与隐私边界](docs/privacy.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [安装指南](docs/installation.md) | 环境、安装、验证、更新与排障 |
| [使用指南](docs/usage.md) | 提交任务、查看对照、修正、确认与继续 |
| [检测配置](docs/configuration.md) | 可选企业词表、自定义规则与检测服务 |
| [架构说明](docs/architecture.md) | 模块职责、工作流与兼容入口 |
| [贡献指南](CONTRIBUTING.md) | 开发、测试和发布检查 |
| [路由参考](skills/privacy-routing/references/routing-policy.md) | 面向代理的协议与授权规则 |
| [安全报告](SECURITY.md) · [更新记录](CHANGELOG.md) | 漏洞报告与版本历史 |

本项目采用 [MIT 许可证](LICENSE)。
