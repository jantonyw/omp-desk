## Context

基线分支 `cursor/theme-switcher-studio-99e7` 已提供四主题与工作室视觉。本 change 叠加上聊天优先布局与 Boop 行语言，参考用户提供的 8.AI 空态 / 模型 tabs 与 Boop inbox 行，但不复制积分、订阅、排行榜等无关营销。

## Goals / Non-Goals

**Goals:**
- 模型主 UX 为横向 scrollable chips；`set_model(provider, id)` 不变
- 空态居中欢迎 + composer；有消息后 dock 到底部
- Sessions / Inspector 为 list rows + status pills
- 四主题同布局；Light 像 8.AI/Boop；保留 theme picker、slash、markdown、Plan/Execute、分组模型

**Non-Goals:**
- 不改 omp / oh-my-pi；不新 RPC；不 React / Tailwind
- 不添加无 RPC 的假 web-search / image 工具
- 不合并基线 PR；本 PR 堆叠在 theme 分支上

## Decisions

1. **Model chips**：`#model-tabs` 在 topbar 中心区横向滚动；每 chip `data-provider` / `data-id`；空 value = omp default。可选小 provider 标签或 `provider · id` 短标，完整 ref 放 `title`。`<select id="model-select">` 保留并 `sr-only` / 隐藏同步，作无障碍与 overflow fallback。
2. **Empty state**：`hasChatMessages()` 仅计 user/assistant；为 false 时 `#pane-chat` 加 `.empty-chat`，显示 `#welcome`，composer 垂直居中；否则隐藏 welcome、composer 贴底。
3. **Composer chrome**：左侧 `#slash-trigger` 聚焦并插入 `/`；右侧圆形 `#send`（箭头或 Send）；`#abort` 仅在 streaming 时显示为 ghost。
4. **Sessions**：`#new-session` 文案「New chat」；会话行：status pill（ready/streaming/stopped）、cwd 描述、model meta；pid 不进主行，可放 title/tooltip。
5. **Inspector rows**：Changes = kind 源色点 + path + kind pill；Tasks = checkbox + title + done/todo pill；空态单行 quiet。
6. **Plan/Execute**：改为 underline tabs（`.mode-tabs`），放在 chat 顶或 composer 旁；逻辑不变。
7. **Tokens**：Light accent 偏蓝 pill（`--accent`）；Dark/Midnight 用 sky pill；半径 `--radius-lg: 14px`、composer `--radius-xl: 16px`；字体保留 sans + 欢迎用轻 serif 栈。
8. **Status bar**：一行摘要（state · model · msgs · mode）；完整含 pid 的串放 `title`。

## Risks / Trade-offs

- 模型很多时 chip 横向滚动；过长 id 用短标 + title，避免顶栏爆炸。
- 隐藏 select 仍同步，避免只改 chip 漏掉现有 change 监听路径。

## Migration Plan

无数据迁移。主题 key / settings / UI mode 不变。
