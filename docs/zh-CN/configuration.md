# 云端模型与检测配置

[项目首页](../../README.zh-CN.md) · [English](../configuration.md)

默认配置可直接使用：规则检测离线运行，语义复核由本地主会话完成。云端分析前需配置供应商与模型；企业词表、自定义规则或额外检测服务按需配置。日常操作见[使用指南](usage.md)，数据去向见[隐私边界](privacy.md)。

Exec 仅使用 `PRIVACY_ROUTER_EXEC_CLOUD_CONFIG`、`PRIVACY_ROUTER_EXEC_CONFIG` 和 `PRIVACY_ROUTER_EXEC_CODEX_BIN`。不会读取或迁移 main 版本的 `PRIVACY_ROUTER_*` 环境变量和云模型配置。请单独配置 Exec；草稿和锁文件与 Exec 的配置保存在同一目录。

## 云端供应商与模型

安装并启用插件后，打开 **Edge-Cloud Collaboration (Exec) 插件详情页 → 设置（Settings）→ 云端模型**，直接填写供应商和账号可用的准确模型 ID，然后点击 **应用配置**。ZIP 导入和商店安装使用同一设置接口，不需要先进入聊天或运行安装脚本。选择 `Custom` 后才显示自定义供应商字段。

详情页逐项编辑会自动保存本机草稿，重启后可继续填写；只有应用成功才会改变后续云端任务使用的配置。点击 **打开完整设置（Open settings）** 可在独立页面查看当前生效配置、应用草稿或撤销更改。完整页面内的新编辑在点击应用前不写入；撤销更改也会清除共享草稿。应用结果由操作按钮反馈，重新打开详情页可刷新状态。保存不验证模型可用性。

需要支持 `openai/settings` 或 MCP App `settings` 入口的客户端。若详情页没有设置区块，请确认插件和 Privacy-router 已启用，重启 MCP 或客户端；较旧客户端可在聊天中要求“打开插件云端模型设置”，或从脱敏页面进入 **云端模型设置**。插件不会在安装后自动打开聊天或向导。

模型配置与当前主会话模型独立。插件不枚举宿主子代理模型，也不根据名称判断模型能力。

- **OpenAI / ChatGPT**：填写模型 ID，可在完整设置页的密码框中直接粘贴 API Key。优先使用页面保存的 Key；未保存时兼容 MCP 进程的 `CODEX_API_KEY`（或 `OPENAI_API_KEY`），否则把当前 Codex 的文件式 `auth.json` 复制到临时目录。使用登录凭据前先运行 `codex login`。不复制仅存于系统钥匙串的凭据；请使用文件式登录或进程 API Key。任务结束后删除临时凭据；临时目录中的令牌刷新不会写回原登录文件。
- **自定义供应商**：填写供应商 ID（字母开头，允许字母、数字、下划线和连字符）、模型 ID、HTTPS 接口地址（如 `https://gateway.example/v1`），并点击 **打开完整设置**，在 **API Key** 密码框中直接粘贴密钥并应用配置，无需设置环境变量或重启。保存后输入框清空并显示“已保存”；留空保留原 Key，填写新 Key 即可替换。更换供应商 ID 或接口地址需重新填写 Key。供应商必须兼容 **Responses API**；仅支持 Chat Completions 的服务需通过兼容网关接入。托管网页搜索还要求供应商、模型和运行时共同支持；公开研究可在托管搜索不可用时通过 shell 联网获取资料，脱敏任务关闭托管网页搜索。
- **超时**：1–600 秒，默认 180 秒。保存仅修改本机配置，不会发起推理。首次真实任务才验证模型可用性和鉴权，失败不会自动切换模型。

配置默认保存在 `$CODEX_HOME/privacy-router-exec/cloud.json`（通常为 `~/.codex/privacy-router-exec/cloud.json`），草稿位于该文件旁的 `cloud.json.draft.json`。可在启动 MCP 前用 `PRIVACY_ROUTER_EXEC_CLOUD_CONFIG` 指定绝对路径。服务原子写入文件，在支持的平台使用 `0600` 权限。页面填写的 Key 与配置一起保存在本机文件中，未加密；文件权限用于限制访问，不等同于系统钥匙串。密钥不进入草稿或工具返回结果，也不会回填到页面。重启和插件升级后仍保留。旧版 `api_key_env` 配置继续兼容，填入新 Key 后切换到直接存储。不要将私人配置提交到仓库；删除正式配置及草稿文件即可清除配置。

如果配置在其他页面或进程中改变，旧草稿不会覆盖新配置。请在完整设置页撤销更改后重新填写。

安装支持 `exec`、`--ephemeral`、`--skip-git-repo-check`、`--sandbox danger-full-access`、标准输入提示词及配置覆盖的 Codex CLI。让 MCP 能通过 `PATH` 找到 `codex`，或用 `PRIVACY_ROUTER_EXEC_CODEX_BIN` 指定本机可执行文件的绝对路径。Windows 请指向原生可执行文件而不是 `.cmd` 包装脚本；启动器使用 `shell:false`，模型仍可调用内置 shell 工具。页面不能配置任意命令，也不会继承 Codex 配置中的其他供应商定义，自定义供应商需在页面重新填写。

保存文件示例（合成数据）：

```json
{
  "provider": "company_gateway",
  "model": "YOUR_AVAILABLE_MODEL_ID",
  "base_url": "https://gateway.example/v1",
  "api_key": "YOUR_API_KEY",
  "timeout_ms": 180000
}
```

模型选择句柄有效 30 分钟，修改上述配置会使旧句柄失效；运行中的任务继续使用启动时的供应商与模型。下方检测配置是独立设置，不决定云端分析模型。

参考：[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)与[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。


## 保护类别

`secret`、`government_id`、`bank_card` 默认强制遮蔽，不能通过配置降级。金额、日期、公司名称等默认由主会话结合任务判断。格式命中或零命中均不等于完成隐私评估。

## 企业词表和规则

将[配置示例](../../config/detection.example.json)复制到插件目录以外的受控位置，通过环境变量 `PRIVACY_ROUTER_EXEC_CONFIG` 指向该 JSON 的绝对路径。确保启动 Codex/MCP 的进程实际继承该变量，重启相关 MCP 服务后生效。不要直接修改安装缓存或把企业词表打进分发包；工具调用不能任意指定配置文件或模型地址。

配置示例（词条是合成示例）：

```json
{
  "version": "enterprise-1",
  "categories": {
    "project_code": "mask",
    "organization": "contextual",
    "amount": "contextual",
    "date": "contextual"
  },
  "dictionary": [
    { "term": "Orion-Example", "type": "project_code", "action": "mask", "case_sensitive": false }
  ],
  "rules": [
    { "type": "project_code", "pattern": "内部编号[:：]([A-Z]{2}-[0-9]{6})", "group": 1 }
  ],
  "rule_timeout_ms": 2000,
  "local_model": { "enabled": false }
}
```

- 类别动作支持 `mask` 和 `contextual`。
- 词表按字面值匹配，默认忽略大小写，并检查英文词边界。`whole_word:false` 可关闭英文边界检查。重复实体使用同一类别和原值时复用占位符。
- 规则使用 JavaScript 正则，捕获组 `group` 为数字，默认遮蔽整个匹配；可选 `flags` 为 `i/m/s/u` 的组合。JSON 中反斜杠需要转义。
- 配置上限：128 条规则、5000 个词条、单次 200000 UTF-16 单元。规则在线程中运行，超时终止；语法错误、无效捕获组等不会被当作“零命中”。
- 不支持自动公开白名单覆盖强保护结果。公开信息应通过上下文复核决定，避免一个宽泛词条放行其中的密钥。
- 未指定的字段使用默认值；未知配置字段会报错。配置变更会使旧预览无法继续确认/交接，需要重新生成。

## 可选检测服务

需要增强自动语义检测时，用下面的对象替换配置中的 `local_model`。该端点需要是已有的兼容 Chat Completions 服务：

```json
{
  "enabled": true,
  "base_url": "http://127.0.0.1:11434/v1",
  "model": "YOUR_INSTALLED_LOCAL_MODEL",
  "timeout_ms": 120000,
  "chunk_chars": 3000,
  "overlap_chars": 256
}
```

`model` 必须改为实际部署的模型标识。插件不会下载模型，也不会将 Codex 当前模型自动变成 HTTP 服务。默认支持本机回环地址；非回环地址必须使用 HTTPS，并在 `trusted_origins` 中显式列出其完整来源，例如 `https://privacy-model.example.internal:8443`。该配置表示管理员确认的受控服务，插件不能证明远端服务器实际位于内网。重定向被拒绝，不能借此跳转到未批准地址。

鉴权使用 `api_key_env` 指定环境变量名；密钥值放在该环境变量中，不写入配置、日志或安装包。HTTP 请求包含原文分块，仅发送到上述显式配置的检测端点。模型输出必须包含 `findings` 数组，每项提供 `type/start/end/text`，偏移使用 UTF-16 且切片必须与 `text` 完全一致。未知类别、缺失字段、无效偏移、无效 JSON、服务不可用和超时都会阻断本次操作。不会静默降级到只跑规则后继续外发。

默认最多同时处理两个分块，块间有重叠，输出会去重；重叠窗口无法保证保留所有跨段语义，仍需主会话复核。`timeout_ms` 是整次模型检测的预算。只有模拟端点协议和异常路径经过本地测试，真实模型的识别率、长文效果与耗时需要在部署环境验证。

## 故障处理

检测失败会阻止本次操作，错误不回显原始敏感值、配置内容或模型响应。

| 错误码 | 检查方向 |
| --- | --- |
| `invalid_detection_config` | JSON 字段、规则和参数范围是否有效 |
| `untrusted_model_endpoint` | 非回环端点是否使用 HTTPS，且完整来源已加入 `trusted_origins` |
| `rule_detection_timeout` | 自定义正则是否过慢 |
| `invalid_model_output` | 响应是否包含有效 JSON、类别及与原文完全对应的 UTF-16 范围 |
| `model_unavailable` | 检测服务地址、鉴权和可用性 |
| `model_detection_timeout` | 整体检测耗时、输入长度与预算 |

修复配置或服务后重试；策略变更需要重新生成预览。不要为了交接而删除必需检测器或改写检测结果。
