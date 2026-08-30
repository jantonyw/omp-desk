## Context

omp-desk 前端现状（与本设计相关的部分）：

- 工作区/会话侧边栏 = `src/components/SessionsPane.tsx`（`#pane-sessions`），含「新会话」按钮、搜索、工作区 accordion、底部设置按钮；由 `App.tsx` 传入回调（`onNewSession` / `onSelectSession` 等）。
- 命令数据已就绪：`src/client.ts` 暴露 `getAvailableCommandsCache()`、`onCommandsChange()`、`fetchAvailableCommands()`，由既有 RPC `get_available_commands` 与 `available_commands_update` 帧驱动；类型 `RpcAvailableSlashCommand` 已在 `src/protocol.ts`。
- composer 插入已有先例：`handleInsertFileReference`（@file 插入）、`handleInsertSlash`（slash 命令插入）。
- omp 内置五个任务代理（scout / librarian / reviewer / designer / security-reviewer）是文档化 bundled subagents（oh-my-pi `task/agents.ts`），通过 `task` 工具以类型名 spawn，不是 slash 命令；`/agents` 是 omp 的 agents hub 命令（TUI dashboard）。
- 约束：不修改 oh-my-pi；不新增 Rust RPC；不自起子进程；Dark 主题 CSS 变量（`--bg-elev`、`--border-soft`、`--fg-dim`、`--accent` 等）。

## Goals / Non-Goals

**Goals:**

- 在 SessionsPane 内新增常驻「智能体」区块：五个内置代理花名册 + 条件性 `/agents` hub 入口。
- 点击 = 插入（非发送）；插入 spawn 指令前缀或 slash 命令，聚焦 composer。
- 全部数据复用既有 RPC 缓存/订阅，零 Rust 改动。

**Non-Goals:**

- 不做 subagent 运行态列表（`get_subagents` 是运行中实例快照，与「可用代理花名册」无关，不接入）。
- 不发送自动消息、不渲染 agent 执行 Trace（已有 Trace 视图）。
- 不引入依赖、不做拖拽/持久化配置。

## Decisions

### D1: 位置 —— SessionsPane 区块，而非活动栏新视图

在 SessionsPane 的 workspace 树下方、底部设置按钮上方新增「智能体」区块（标题行 + 代理列表，可折叠）。

- 备选：IdeSidePanel 活动栏新增 `agents` 视图（与 explorer/scm/browser 并列）。
- 理由：需求写明「工作区/会话侧边栏（或 工作区 旁的 tab）」；SessionsPane 是工作区/会话侧边栏，常驻可见、无需切换视图即满足「可见的智能体集合」；活动栏方案需扩 `ViewId` union 且与 Explorer 等互斥，花名册默认隐藏，visibility 更差。

### D2: 数据源 —— 静态花名册 + 条件性命令入口

- 五个内置代理用常量花名册（`src/agents.ts`：`{ name, label, icon, description }[]`），始终展示 —— 它们是 bundled agents，不在 slash 命令列表里，硬编码是被 operator 确认的事实来源（oh-my-pi `task/agents.ts`），不属于「发明 RPC」。
- hub 入口从 `getAvailableCommandsCache()` 动态过滤（`name === "agents"` 或 aliases 含 "agents"）；订阅 `onCommandsChange` 刷新；缓存为空时触发一次 `fetchAvailableCommands()`（既有函数，走既有 RPC）。命令到达时入口出现，否则仅花名册。

### D3: 点击行为 —— 插入而非发送

- 代理行点击 → 向 composer 插入自然语言 spawn 指令前缀，例：`请使用 task 工具启动 scout 子代理（侦察）完成任务。任务：`。已有草稿则追加（`草稿 + "\n\n" + 前缀`），不静默丢弃。
- hub 入口点击 → 复用 App 现有 slash 插入路径（同 `handleInsertSlash` 行为：composer 置为 `/agents` 并聚焦）。
- 不自动发送：发送时机留给用户补充任务后按 Enter，与现有 @file / slash 交互一致，避免误触发 omp。

### D4: 组件与接线

- 新建 `src/components/AgentCollection.tsx`（自订阅 client.ts 命令缓存；props 仅 `onInsertSpawn(text)` 与 `onInsertSlash(cmd)`）。
- SessionsPane 新增同名区块并透传 props；App.tsx 新增 `handleInsertAgentSpawn`（追加前缀并聚焦）与复用 `handleInsertSlash`。
- 样式全部用现有 Dark token，新增 `.agent-*` 类到 `src/style.css`，沿用 workspace 区块的圆角/边框/字号节奏。

## Risks / Trade-offs

- [RPC 模式下 `/agents` 是 TUI dashboard 命令（`handleTui`），经 prompt 发送后行为由 omp 决定（可能只是 hub 说明或 TUI 无效）] → hub 入口仅在该命令出现在 `get_available_commands` 时展示，属于「驱动 omp 真实暴露的命令」；花名册与 spawn 指令路径不受影响。
- [命令缓存为空时入口缺失] → 订阅 `onCommandsChange` 并在挂载时 `fetchAvailableCommands()` 一次；缓存为空期间花名册照常展示。
- [自然语言 spawn 指令依赖 omp 正确理解 agent 类型名] → 指令前缀使用 omp 文档化的 agent 名（如 `scout`）并点名 `task` 工具，与 omp system prompt 的 subagent 描述一致。
