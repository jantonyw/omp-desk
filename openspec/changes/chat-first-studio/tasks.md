## 1. OpenSpec

- [x] 1.1 新增 openspec/changes/chat-first-studio（proposal/design/tasks + model-tabs / chat-empty-state / boop-rows / studio-surface specs）

## 2. Model tabs

- [x] 2.1 HTML：`#model-tabs` 横向 chip 行；`<select id="model-select">` 隐藏同步
- [x] 2.2 TS：`renderModelSelect` 同时渲染 chips；点击 chip 调既有 `set_model`；omp default 为首；title 显示完整 ref；overflow 可横向滚动

## 3. Empty-state composer

- [x] 3.1 HTML/CSS：欢迎「Ask omp」、居中 wide rounded well；placeholder「Ask me anything」+ slash 提示
- [x] 3.2 有 user/assistant 后 composer dock 到底；左侧 `/` 触发 slash；圆形 Send；Abort ghost（streaming）

## 4. Boop rows

- [x] 4.1 Sessions：New chat 主按钮；会话行 status pill + cwd + model meta
- [x] 4.2 Changes/Tasks：行布局 + status pill；安静空态
- [x] 4.3 Plan/Execute 改为 underline tabs

## 5. Studio surface

- [x] 5.1 Light 白底软边 12–16px 圆角；Dark/Midnight 同布局
- [x] 5.2 状态栏安静一行；pid 在 tooltip；`#app` 全宽；主题选择器保留

## 6. Verify

- [x] 6.1 bun run build 通过
- [x] 6.2 堆叠 PR 基线 `cursor/theme-switcher-studio-99e7`，不合并
