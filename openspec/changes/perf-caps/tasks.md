## 1. OpenSpec

- [x] 1.1 新增 openspec/changes/perf-caps（proposal/design/tasks + streaming-render / memory-caps / event-bridge / webview-gpu specs）

## 2. Frontend streaming + caps

- [x] 2.1 `client.ts`：stream vs full 通知；`entries` / `changedFiles` 上限；live assistant 设 `streaming`
- [x] 2.2 `main.ts`：rAF 合并；流式只更新 live bubble textContent；结束时再 markdown sanitize；保留 slash/主题/chips/Plan-Execute

## 3. Rust event bridge + chunks

- [x] 3.1 有界 stream 队列 + critical 永不丢；`text_delta`/`thinking_delta` ~16ms/N coalesce
- [x] 3.2 Chunk pending：超限/空闲超时 abort；Host 无无限帧日志（stderr ring 若保留）

## 4. WebView GPU

- [x] 4.1 Linux：清除禁用合成 env；`with_webview` hardware-acceleration Always；注释说明非 wgpu
- [x] 4.2 Windows：`additionalBrowserArgs` 启用 GPU；macOS 不主动禁用硬件加速

## 5. Verify

- [x] 5.1 `bun run build` 通过；`cargo check`（src-tauri）通过
- [x] 5.2 堆叠 PR 基线 `cursor/chat-first-studio-0f6f`，不合并
