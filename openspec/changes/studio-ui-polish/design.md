## Context

omp-desk 是 Tauri 2 外壳，spawn `omp --mode rpc-ui`。Codex-like 三栏与绑定模型选择器已在前序 change 落地。本 change 只打磨 UI/协议接线，不重写 agent。

## Goals / Non-Goals

**Goals:**
- 模型下拉按 provider 分组，完整 id 可见，切换走 `set_model`
- `/` slash 面板来自 `get_available_commands` + `available_commands_update`，发送走现有 prompt 路径
- 助手 Markdown 渲染 + sanitize；Plan 前缀不产生重复用户气泡
- 密集暗色布局适配 1200×760；`message_count` 正确递增

**Non-Goals:**
- 不修改 oh-my-pi / omp
- 不发明 `enter_plan_mode` / `slash_command` 等 RPC
- 不引入 React 或新 UI 框架
- 不合并既有 PR #1；本 change 在独立分支上实现

## Decisions

1. **模型分组**：`renderModelSelect` 用 `<optgroup label="{provider}">`；保留空值「omp default」。若响应里带有 default/smol/slow/plan 角色信息则标注，否则仅分组。显示与状态栏一律用 `provider/id`，CSS 不用 ellipsis 裁切模型身份。
2. **Slash 命令**：ready 后 `get_available_commands`；`handleEvent` 处理 `available_commands_update`。选中插入 `/name`（有 hint 则加空格便于填参）。以 `/` 开头的发送跳过 Plan/Execute 前缀注入。
3. **Markdown**：`marked` 解析助手正文，DOMPurify（或等价 allowlist）消毒。用户气泡 `escapeHtml`。任务文案 strip `**`/`*`/`__`/`_` 强调。
4. **Plan 回显**：`echoUser` 在比较前剥离 `PLAN_PREFIX` / `EXECUTE_PREFIX`，或以这些前缀开头时跳过回显。
5. **消息计数**：ready / agent_end / 用户发送后通过真实 `get_state` 同步 `messageCount`；发送时本地先 +1 以即时反馈。
6. **布局**：窗口保持 ≤1200 宽；13px UI / 14px chat；Inter 或 system-ui + mono 代码；8px padding；composer 与状态栏始终可见。

## Risks / Trade-offs

- Slash 命令是否由 omp 本地处理取决于 agent；外壳只当 prompt 转发。
- 角色标注依赖响应字段；缺失时仅 provider 分组，可接受。

## Migration Plan

无数据迁移。依赖通过 bun 安装。
