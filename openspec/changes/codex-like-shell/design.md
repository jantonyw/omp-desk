## Context

omp-desk 是 Tauri 2 外壳，通过 stdio JSONL 驱动 omp --mode rpc-ui。核心 agent 已有模型目录、plan CLI（--plan / --plan-yolo）以及 RPC get_available_models / set_model。当前 UI 是单栏加手填模型。

## Goals / Non-Goals

**Goals:**
- 从已绑定模型列表选择
- 明确的 Plan 然后 Execute 流程
- 三栏工作室布局
- 继续只做外壳

**Non-Goals:**
- 不修改 oh-my-pi 源码
- 不自建第二套 LLM 客户端
- 不做完整 IDE
- 不做多项目后台

## Decisions

1. 模型列表走 RPC，不读 ~/.omp YAML。会话 ready 后发 get_available_models；切换发 set_model。settings.model 为空则不加 --model。
2. Plan 模式优先用 omp 已有开关。以 rpc-types.ts 与 omp --help 为准，禁止臆造命令名。
3. 三栏纯 CSS/HTML，不引入 React。默认窗口高度不超过 800，composer 必须可见。
4. Changes 面板订阅已有 tool 事件。
5. 包管理 bun。

## Risks / Trade-offs

- RPC 的 plan 表面可能弱于 TUI：降级为系统提示加用户确认后再发执行 prompt。
- 选择器在 ready 前禁用。
- 窄屏允许折叠右侧，但 1280x800 必须看到 composer。

## Migration Plan

无数据迁移。新增 UI 状态键可加 omp-desk.ui。
