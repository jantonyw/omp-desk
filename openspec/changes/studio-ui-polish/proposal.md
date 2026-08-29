## Why

三栏工作室 UI 已可用，但模型选择是扁平下拉、助手消息只显示转义明文、composer 没有 slash 命令面板，且布局在 ~1280×800 下会裁切 Inspector / 状态栏。需要在不改 omp 核心的前提下把工作室表面打磨到可用密度。

## What Changes

- 模型选择器按 provider `<optgroup>` 分组；切换仍走真实 RPC `set_model`；顶栏与状态栏显示完整 `provider/id`，不截断。
- Composer 在输入 `/` 时展示可过滤的 slash 命令面板，数据来自 `get_available_commands` 与 `available_commands_update`；选中后作为普通 `prompt` / `abort_and_prompt` 发送（不发明 slash RPC）。
- 助手消息渲染 Markdown（经 sanitize）；用户气泡保持转义文本；去掉 Plan 前缀回显造成的重复 YOU 气泡；TASKS 去掉 `**` 强调标记。
- 密集暗色 zinc 工作室布局，适配约 1200×760 / 1280×800；修复 `message_count` 不更新。

## Capabilities

### New Capabilities
- `model-groups`: 按 provider 分组的绑定模型选择，完整模型 id 可见
- `command-composer`: `/` 命令面板，基于真实 available-commands RPC/事件
- `markdown-ui`: 助手 Markdown、Plan 回显去重、密集布局与消息计数

### Modified Capabilities

## Impact

- 前端：`src/main.ts`、`src/client.ts`、`src/protocol.ts`、`index.html`、`src/style.css`
- 依赖：`marked` + DOMPurify（bun）
- Rust：仅在需要时为 `available_commands_update` / `get_state` 透传分类；不改 omp spawn 契约
- 不修改 oh-my-pi / omp 源码
