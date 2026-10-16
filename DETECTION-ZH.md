# 通用脱敏配置（0.1.0）

本插件导入 Codex 后以 Node.js stdio MCP 运行，不依赖 Python。默认规则检测不联网，语义判断由已经确认本地部署的 Codex 主会话完成。独立本地模型是可选项；不配置时无需安装模型服务。

## 默认行为

1. `detect_sensitive_content` 返回 UTF-16 位置、类别、检测来源和保护要求，不返回原始值。
2. 主会话逐项复核公开性、保密性及分析所需信息，补充规则无法识别的敏感语义。
3. `create_redaction_review` 再次检测同一原文，生成对照，等待用户确认。
4. 修改预览始终保留强保护片段。策略变化需要重新生成预览；检测失败不能交接。
5. 云端只接收已确认的脱敏正文和经过检查的任务说明。原文和映射留在本地进程及确认界面。

默认强保护类别为 `secret`、`government_id`、`bank_card`。格式校验只是检测依据，不是完整真实性证明；不要用未命中推断无敏感信息。金额、日期、公司名称等默认是 `contextual`，由主会话和用户结合本次任务决定。没有合同、财务等固定场景模板。若必要内容无法安全交给云端，可以由用户选择在本地完成任务。

## 企业词表和规则

无需自定义时不设置任何环境变量。需要配置时，将 `config/detection.example.json` 复制到插件目录以外的受控位置，通过启动 Codex/MCP 进程的环境变量 `PRIVACY_ROUTER_CONFIG` 指向该 JSON 的绝对路径。确保 Codex 进程实际继承该变量，重启相关 MCP 服务后生效；不要直接修改安装缓存或把企业词表打进分发包。主会话不能通过工具参数任意指定配置文件或模型地址。

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

- 类别动作支持 `mask` 和 `contextual`。强保护内置类别不能降级。
- 词表按字面值匹配，默认忽略大小写，并检查英文词边界。`whole_word:false` 可关闭英文边界检查。重复实体使用同一类别和原值时复用占位符。
- 规则使用 JavaScript 正则，捕获组 `group` 为数字，默认遮蔽整个匹配；可选 `flags` 为 `i/m/s/u` 的组合。JSON 中反斜杠需要转义。Python 的 `(?P<value>...)` 规则不能直接复制。
- 配置上限：128 条规则、5000 个词条、单次 200000 UTF-16 单元。规则在线程中运行，超时终止；语法错误、无效捕获组等不会被当作“零命中”。
- 不支持自动公开白名单覆盖强保护结果。公开信息应通过上下文复核决定，避免一个宽泛词条放行其中的密钥。
- 未指定的字段使用默认值；未知配置字段会报错。配置变更会使旧预览无法继续确认/交接，需要重新生成。

## 可选独立本地模型

需要增强自动语义检测时，在相同 JSON 的 `local_model` 中配置已有的兼容 Chat Completions 服务：

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

工具返回安全错误代码，不回显原始敏感值、配置内容或模型响应。`invalid_detection_config` 表示配置无效；`rule_detection_timeout` 表示规则超时；`invalid_model_output` 表示模型响应不合格；`model_unavailable` 表示模型请求失败；`model_detection_timeout` 表示整体模型检测超时。修复本地配置或服务后重试。不要为了交接而删除必需检测器或改写检测结果。

这些检查约束本插件工作流，不能拦截 Codex 的其他工具或保证任何模型百分之百遵守技能指令。默认原文与映射不落盘；退出 MCP 进程会清除预览状态。
