## Why

omp-desk 现在只是单栏聊天外壳：模型是手填字符串，不能从本地 `omp` 已绑定的模型里选；也没有 Codex 那种「先 plan、再拆任务执行」的工作流。用户需要一个更接近 Codex / Oh My Pi 桌面的产品表面，同时核心仍然是现有 `omp` 进程，不重写 agent。

## What Changes

- 会话顶栏提供**已绑定模型选择器**，数据来自 `omp` RPC `get_available_models`，切换走 `set_model`，不再只靠启动参数覆盖。
- 增加 **Plan / Execute** 工作流：先进入只读规划（对齐 omp 的 plan 能力），用户确认后再进入代码执行；计划可拆成可勾选步骤。
- 界面改为内容更丰富的三栏布局（会话/项目 · 对话 · 文件变更与运行），参考 Codex / Oh My Pi 桌面，而不是单栏终端。
- 开发过程引入 OpenSpec（本 change），实现按 `tasks.md` 分步落地。外壳仍只 spawn `omp --mode rpc-ui`。

## Capabilities

### New Capabilities
- `bound-models`: 列出并切换本地 omp 已配置/已绑定的模型
- `plan-execute`: 先规划后执行的会话模式，任务拆解与确认
- `studio-ui`: 三栏工作室界面（会话列表、对话、变更/运行）

### Modified Capabilities

## Impact

- 前端：`src/main.ts`、`src/client.ts`、`src/protocol.ts`、`index.html`、`src/style.css` 重构成三栏 + 模型下拉 + Plan/Execute 控件
- Rust：`src-tauri/src/lib.rs`、`process.rs` 透传 `get_available_models` / `set_model` 及 plan 相关 RPC/CLI 参数
- 不修改 `/workspace/oh-my-pi` 与 `omp` 核心
- 依赖：仍是 Tauri 2 + 现有 `@tauri-apps/api`；包管理 bun
