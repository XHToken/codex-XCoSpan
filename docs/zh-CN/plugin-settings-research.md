# 插件安装引导与详情页云端模型配置调研

调研日期：2026-10-19。此文保留调研时的源码证据。后续已接入原生设置与独立设置入口，并添加协议、UI 和 ZIP 测试；尚未在真实 Codex 详情页完成视觉验收。具体使用方式见 [configuration.md](configuration.md)。

## 结论

当前安装的桌面客户端包含两种无需聊天的插件设置机制：

1. MCP 服务声明 `openai/settings`，由客户端在插件详情页直接渲染原生配置表单。
2. MCP 工具声明 `openai/ui` 的 `settings` 入口，由详情页提供“打开设置”，进入独立的 MCP App 设置页。

第一种最符合“用户在插件页面显式填写云端模型”的需求。该发现修正了此前“需要修改客户端才能提供详情页配置”的判断。不能只检查 plugin.json 的 interface 字段：设置能力还由 MCP 服务的初始化响应和工具元数据提供。

安装完成后的 `onboardingSkill` 引导也确实存在，但它提供的是开始设置聊天的入口，不是独立表单向导。没有在所检查的安装流程里找到安装成功后自动打开上述设置表单的插件声明接口。

| 需求 | 调查结果 | 限制 |
| --- | --- | --- |
| 插件详情页直接填表 | 有现成实现：`openai/settings` | 插件安装并启用、MCP 正常启动、读写工具可发现；需要目标客户端验收 |
| 插件详情页点击后打开独立设置页 | 有现成实现：`openai/ui.entrypoints` 的 `settings` 类型 | 需要有效 UI 资源和对应工具；不是聊天弹窗 |
| 安装后出现设置邀请 | 有 `extensions.com.openai.onboardingSkill` | 检查到的后续流程会进入聊天，且有客户端能力条件 |
| 安装后自动打开独立配置表单 | 未发现相应插件接口 | 不能用 onboardingSkill 的存在推导出这个能力 |
| ZIP 安装后提供详情页设置 | MCP 发现和详情页匹配逻辑不依赖 install.mjs 或商店来源 | 此为代码路径判断，尚未用新 ZIP 实测；不能承诺所有客户端版本 |

## 证据与范围

检查对象：

- 本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar`，应用版本 `26.1013.40934`。
- 本机 Codex 源码 `/Users/FLQQDV4KJP/Documents/source/codex`，HEAD `12cca49c81`，提交日期 2026-10-12。
- 当前插件工作区中的 MCP 初始化、设置工具和配置持久化实现。

官方文档地址本次仍未能成功获取，因此没有把上述扩展表述为已经核实的公开、稳定兼容协议。本次结论基于客户端静态代码和后端测试源码，不是运行截图验收。自动化工具禁止访问该桌面应用界面，未绕过限制进行操作；未安装测试插件、修改客户端、修改真实云端模型配置或发起云端推理。

### 1. 详情页确实渲染原生设置

客户端 `webview/assets/plugin-settings-section-401ce05b1068.js`：

- 对已安装插件匹配 MCP 设置视图。
- 创建标题为 `Settings`、ID 为 `plugin-settings` 的详情页区块。
- 带 `updateTool` 的结构化设置视图直接渲染配置表单。
- 自定义 MCP App 设置视图显示 `Open settings` 按钮，并进入专用设置路由。

`plugin-detail-page-4c9a1dad004c.js` 将此区块传给详情页；`plugin-detail-view-e7958bf818b0.js` 将其渲染到详情内容中。客户端另有同名相关功能开关，但检查到的结构化设置区块不能简单等同于该开关；最终可见性仍应通过目标版本实测确认。

`find-plugin-mcp-extension-view-5180f75d0760.js` 根据插件 ID、连接器或 MCP 服务名匹配设置视图；此匹配逻辑没有要求插件必须来自远程商店。

### 2. MCP 设置扩展有完整发现链路

客户端 `app-initial-90eb42395b7d.js` 读取 MCP serverCapabilities 中的 `extensions["openai/settings"]`，兼容从 `experimental` 读取；要求配置包含两个不同的、实际存在的工具名 `readTool` 和 `updateTool`。

后端测试 `codex-rs/app-server/tests/suite/v2/mcp_server_status.rs`：

- 约第 800 行验证 `mcpServerStatus/list` 保留 `extensions["openai/settings"]`。
- 约第 1235 行的测试服务声明 `settings.read`、`settings.update`。
- 这是能力透传测试，不是插件设置表单的端到端测试。

### 3. 安装后的 onboarding 是聊天引导

`plugin-installation-content-2834f3cb0233.js` 的安装完成流程调用 onboarding 检查：读取 `plugin/read` 的 `onboardingSkill`，检查技能是否启用以及客户端是否支持 `pluginOnboarding`，再展示引导对话框。

`dialog-b3f77b3b11f6.js` 中的按钮文案和描述明确为：

- `Set up {pluginName}`。
- `Start a conversation with the plugin’s onboarding skill`。
- `Maybe later`：不启动会话并关闭引导。

因此，该引导不能满足“安装时直接在独立表单填写”的要求。

## 推荐接入：详情页原生表单

以下保留调研时的接口示例。当前实现已注册这些工具；实际字段包含供应商类型和以秒为单位的超时，详见 `mcp/cloud-settings.mjs`。MCP 初始化响应使用如下能力声明：

```json
{
  "capabilities": {
    "tools": { "listChanged": false },
    "extensions": {
      "openai/settings": {
        "readTool": "cloud_settings_read",
        "updateTool": "cloud_settings_update"
      }
    }
  }
}
```

保留当前已有的 resources 等能力。读工具由客户端以空参数调用，其 `structuredContent` 返回：

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "provider": { "type": "string", "title": "供应商 ID" },
      "model": { "type": "string", "title": "模型 ID" },
      "base_url": { "type": "string", "title": "HTTPS 接口地址" },
      "api_key_env": { "type": "string", "title": "API Key 环境变量名" },
      "timeout_ms": {
        "type": "integer", "title": "超时（毫秒）",
        "minimum": 1000, "maximum": 600000
      }
    }
  },
  "values": {
    "provider": "openai",
    "model": "",
    "base_url": "",
    "api_key_env": "",
    "timeout_ms": 180000
  }
}
```

客户端 `page-cea78c03639a.js` 的约定：

- 支持 `string`、`boolean`、`number`、`integer`；字符串枚举显示为选项菜单。
- 每个属性需要相应类型的当前值，包括尚未配置时的默认值。
- 字符串和数字在失焦或按 Enter 时触发更新；布尔值和枚举直接更新。
- 更新参数为 `{ "set": { "model": "新的模型 ID" } }`，并非完整 config 对象。
- 更新结果的 `structuredContent` 至少包含 `values`；更新后客户端重新读取设置。
- `layout` 可声明分组及 `kind: "property"`、`kind: "tool"` 项。工具项可作为“应用配置”操作；普通按钮动作使用空参数调用工具。
- 检查到的原生字符串控件为普通文本输入，不应把它当作具备密钥遮罩或凭据保险库的输入控件。

建议使用“编辑草稿 → 应用配置”的方式：

1. 读写工具操作独立草稿，允许用户尚未填齐必需字段。
2. 在表单内提供“应用配置”工具按钮；一次校验供应商、模型、地址、环境变量名之间的约束。
3. 校验通过后，复用现有 `saveCloudConfig` 写入正式配置。
4. 云端任务只使用正式配置；未完成草稿不覆盖当前有效配置。

这一步很重要：现有 `save_cloud_settings` 接收完整 config，`saveCloudConfig` 不接受缺失 model 等不完整配置，不能直接拿它接客户端的逐字段更新。

后续已支持在独立设置页的密码框直接填写 API Key，并保存到本机受限权限的配置文件。原生表单不提供密钥文本框，使用“打开完整设置”进入密码框；工具读取只返回保存状态，不返回密钥。以上 JSON 保留早期调研样例，当前接口以运行代码为准。

## 备选：独立 MCP App 设置页

如果需要复杂的供应商联动、较长输入框或自定义保存交互，可在设置工具元数据中增加：

```json
{
  "_meta": {
    "openai/ui": {
      "entrypoints": [{ "type": "settings" }]
    }
  }
}
```

还需保留有效的 `ui://` 资源关联和正常工作的工具响应。客户端将其发现为设置入口；详情页显示“打开设置”，进入独立页面。该方案不是自动安装向导，也不是聊天中弹出面板。

## 接入前为什么没有显示（历史记录）

接入前 `mcp/server.mjs` 的初始化响应仅声明 tools 和 resources，没有 `openai/settings`。

`open_cloud_settings`（约第 753 行）声明了 UI 资源，但没有 `openai/ui.entrypoints` 的 settings 入口。

接入前读工具返回 `{ ok, cloud_settings, configured, config, next_step }`，也不符合原生表单要求的 `{ schema, values, layout? }`。因此当时的聊天表单不会自动出现在插件详情页。

## 后续验收

建议先接入原生设置表单，再分别对 ZIP 安装和商店安装做验收：

1. 新安装并启用插件后，不启动聊天，打开插件详情页确认表单可见。
2. 未配置状态能正常展示；逐字段编辑不会破坏已有正式配置。
3. 应用配置后重开详情页、重启 MCP，数据仍保留。
4. 升级 ZIP 后配置仍保留；卸载重装行为符合约定。
5. MCP 未运行或客户端不支持扩展时，给出明确配置说明。

当前建议：以“详情页原生配置表单”为主入口；不要依赖额外安装器或 onboardingSkill 来满足 ZIP 用户的配置需求。安装后自动定位或自动展开该表单可作为另一项客户端兼容性验证，不承诺已有插件接口可以强制触发。
