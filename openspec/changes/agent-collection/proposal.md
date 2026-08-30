## Why

omp-desk 目前把 omp 的 subagent 能力完全藏在了会话里：用户要自己知道怎么写 spawn 指令才能让 scout / reviewer 这类专用任务代理干活。Super Engineer 类 agent roster 的体验（一键调出侦察、检索、审查、设计、安全审查专家）在 omp 已有的五个内置任务代理上完全可复刻，但当前 UI 没有入口。用户需要可见的「智能体集合」，把 omp 真实内置的任务代理摆到工作区/会话侧边栏里，一键插入 spawn 指令。

## What Changes

- 在工作区/会话侧边栏（SessionsPane）新增「智能体」集合区块，列出 omp 真实内置的五个任务代理（短中文标签 + 英文名）：scout 侦察、librarian 检索、reviewer 审查、designer 设计、security-reviewer 安全审查。
- 数据源优先走既有 RPC `get_available_commands` / `available_commands_update`：若 omp 暴露 `/agents` 命令（或其别名），展示「Agents Hub」入口并优先驱动它；五个内置代理属于文档化 bundled agents（oh-my-pi `task/agents.ts`），始终作为静态花名册展示。
- 点击代理行向 composer 插入一条清晰的自然语言 spawn 指令前缀（沿用现有 `@file` 插入模式），由用户补充任务后发送；点击 `/agents` 入口则按现有 slash 插入逻辑插入该命令。
- 不改 omp、不发明 RPC：仅复用 omp-desk 已有的 `get_available_commands` 缓存与通知（client.ts），不新增 Rust RPC，不自起子进程。
- 视觉匹配当前 Dark 主题 CSS 变量；保留 Chat / Plan / Execute / Trace / Explorer / 会话历史全部现有功能。

## Capabilities

### New Capabilities
- `agent-collection`: 侧边栏可见的智能体集合——内置任务代理花名册展示、`/agents` 命令优先驱动、点击插入 spawn 指令到 composer

### Modified Capabilities

（无既有能力的需求级变更；本 change 仅新增能力。）

## Impact

- 前端：`src/components/SessionsPane.tsx`（或新建 `src/components/AgentCollection.tsx` 接入侧边栏）、`src/App.tsx`（透传插入回调）、`src/style.css`（智能体区块样式）、`src/agents.ts`（静态花名册常量，如新建）。
- 复用 `src/client.ts` 既有 `getAvailableCommandsCache` / `onCommandsChange` / `fetchAvailableCommands`；`src/protocol.ts` 类型不变或仅复用。
- 不修改 oh-my-pi / omp；不新增 Rust RPC、不新增依赖；Tauri 侧零改动。
