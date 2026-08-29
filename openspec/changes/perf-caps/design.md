## Context

基线 `cursor/chat-first-studio-0f6f`（PR #5）已是聊天优先工作室壳。本 change 只解决长会话 RAM/CPU 与 WebView 软件合成回退，不改可见交互语义。

## Goals / Non-Goals

**Goals:**
- 流式 token 不整表 `innerHTML`、不每 token 跑 marked/DOMPurify
- `entries` / `changedFiles` / 高流量 `rpc_event` 有界
- WebKit/WebView2 走硬件合成（GPU compositing）
- 保留 slash、主题、模型 chip、Plan/Execute、RPC 协议

**Non-Goals:**
- 不引入 wgpu / Vulkan compute / egui / iced / React
- 不重写 UI；不修改 omp / oh-my-pi
- 不合并基线 PR；本 PR 堆叠在 chat-first-studio 上

## Decisions

1. **流式 DOM**：`client.ts` 在 `text_delta`/`thinking_delta` 时以 `mode: "stream"` 通知；`main.ts` 用 rAF 合并，只改 live bubble 的 `textContent`（或 thinking 节点）。结构变化或 turn 结束用 `mode: "full"`，此时再 `marked` + DOMPurify。
2. **Caps**：`MAX_TRANSCRIPT_UAT = 200`（user/assistant/tool）；system 可随最旧 UAT 一并裁掉或保留少量；`MAX_CHANGED_FILES = 100`，超出丢最旧。
3. **Rust bridge**：stdout 读线程经 `EventOutbox` 入队。可合并的 assistant delta 在 ~16ms 或满 N 条后合成一条再 emit；高流量队列容量有限，背压丢最旧 stream；`ready`/`response`/`prompt_result`/`available_commands_update`（及 `extension_ui_request`/`exited`/`protocol_error`）走 critical 路径永不丢。
4. **Chunk**：保留 `MAX_REASSEMBLED_BYTES`；`feed` 超限或序列空闲超时则 abort pending 并 `protocol_error`。
5. **Host 历史**：Host 不保存无限帧日志；若有 stderr 缓存则 ring（64）。
6. **GPU**：启动前 `remove_var("WEBKIT_DISABLE_COMPOSITING_MODE")`（及不主动设软件渲染 env）；Linux `with_webview` → `HardwareAccelerationPolicy::Always`；Windows `additionalBrowserArgs` 含 `--enable-gpu`（并保留 wry 默认 disable-features）；注释写明 GPU = WebKit compositing，非 wgpu。
7. **Release**：保持现有 `lto` / `strip` / `codegen-units = 1`。

## Risks / Trade-offs

- 合并 delta 会略增流式延迟（≤16ms），可接受。
- 背压丢 stream 时 UI 可能跳字，但 turn 结束的 `message_end`/`text_end` 仍会校正全文。
- 强制 Always 硬件加速在部分 NVIDIA + WebKitGTK 组合上仍可能有驱动问题；我们选择性能默认，不默认设 `WEBKIT_DISABLE_*`。

## Migration Plan

无数据迁移。settings / theme / UI mode keys 不变。
