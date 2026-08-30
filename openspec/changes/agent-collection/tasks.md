## 1. 花名册数据与组件

- [x] 1.1 新建 `src/agents.ts`：内置五代理常量（scout 侦察 / librarian 检索 / reviewer 审查 / designer 设计 / security-reviewer 安全审查，含图标与一句话描述）与 spawn 指令前缀生成函数；验证 `bun run build` 通过且导出被组件引用
- [x] 1.2 新建 `src/components/AgentCollection.tsx`：订阅 client.ts 命令缓存（`onCommandsChange` + 挂载时 `fetchAvailableCommands()`），渲染花名册与条件性 `/agents` hub 入口，点击调用 `onInsertSpawn` / `onInsertSlash`；验证组件编译通过
- [x] 1.3 SessionsPane 加入「智能体」区块（workspace 树下方、底部设置上方），透传插入回调；验证侧边栏渲染不破坏现有区块

## 2. Composer 接线

- [x] 2.1 App.tsx 新增 `handleInsertAgentSpawn`（空 composer 置前缀、非空追加 `\n\n` 前缀、聚焦 composer）并经 SessionsPane 传入 AgentCollection；验证点击代理后 composer 出现含代理名的中文 spawn 指令前缀且不自动发送
- [x] 2.2 hub 入口复用 `handleInsertSlash` 路径插入 `/agents`；验证仅当命令缓存中存在 `agents` 命令时入口可见

## 3. 样式与验证

- [x] 3.1 `src/style.css` 新增 `.agent-*` 样式，全部使用现有 Dark 主题 CSS 变量（`--bg-elev`/`--border-soft`/`--fg-dim`/`--accent` 等），hover/焦点态齐备；验证视觉与 workspace 区块一致
- [x] 3.2 保留 Chat / Plan / Execute / Trace / Explorer / 会话历史功能不变；验证 `bun run build` 通过
- [x] 3.3 Rust 无改动，运行 `cargo check`（src-tauri）确认后端编译通过
