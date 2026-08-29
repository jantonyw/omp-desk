## Why

长会话下 omp-desk 内存与 CPU 会持续爬升：前端每次 `text_delta` 整表 `innerHTML` + marked/DOMPurify；`entries` / `changedFiles` 无上限；Rust 侧无界 `mpsc` 把每个 stdout 帧原样灌进 WebView。另外 Linux WebKit 可能回落到软件合成。本 change 在**不改 UI/RPC 行为**的前提下止血，并启用 WebView 硬件合成（不是 wgpu 场景）。

## What Changes

- 流式输出：只更新当前 assistant 气泡（plain text），整表重建与 markdown sanitize 延到 turn 结束；`requestAnimationFrame` 合并同帧多次 delta。
- 上限：transcript 保留最近约 200 条 user/assistant/tool；changed-files 约 100。
- Rust：合并 `text_delta` / thinking 流事件（~16ms 或 N 条）；高流量事件用有界队列（背压时丢最旧 stream）；永不丢 `ready` / `response` / `prompt_result` / `available_commands_update`。
- Chunk 重装：保持 64MB 上限，超时或超限则中止 pending，不无限增长 `received`。
- WebView GPU：Linux 设 WebKit `hardware-acceleration-policy=Always`、清除禁用合成的 env；Windows `additionalBrowserArgs` 启用 GPU；注明 GPU = WebKit 合成，非 wgpu。

## Capabilities

### New Capabilities
- `streaming-render`: 流式增量 DOM，结束时再 markdown
- `memory-caps`: transcript / changed-files 有界
- `event-bridge`: Rust 侧 coalesce + 有界 stream 队列
- `webview-gpu`: WebKit/WebView2 硬件合成提示

### Modified Capabilities

## Impact

- 前端：`src/main.ts`、`src/client.ts`
- Rust：`src-tauri/src/lib.rs`、`process.rs`、可选 bridge；`tauri.conf.json`
- OpenSpec：本 change 目录
- 不修改 omp / oh-my-pi；不引入 React / wgpu / egui；不改变 Plan/Execute、slash、主题、模型 chip 行为
