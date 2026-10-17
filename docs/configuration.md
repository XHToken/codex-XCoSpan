# 检测配置

默认配置可直接使用：规则检测离线运行，语义复核由本地主会话完成。只有需要企业词表、自定义规则或额外检测服务时，才需要本页配置。日常操作见[使用指南](usage.md)，数据去向见[隐私边界](privacy.md)。

## 保护类别

`secret`、`government_id`、`bank_card` 默认强制遮蔽，不能通过配置降级。金额、日期、公司名称等默认由主会话结合任务判断。格式命中或零命中均不等于完成隐私评估。

## 企业词表和规则

将[配置示例](../config/detection.example.json)复制到插件目录以外的受控位置，通过环境变量 `PRIVACY_ROUTER_CONFIG` 指向该 JSON 的绝对路径。确保启动 Codex/MCP 的进程实际继承该变量，重启相关 MCP 服务后生效。不要直接修改安装缓存或把企业词表打进分发包；工具调用不能任意指定配置文件或模型地址。

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
