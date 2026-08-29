## Why

PR #3 的工作室表面仍像调试控制台：全大写标签、原生下拉廉价感、composer 像原始 textarea、聊天像终端 dump。用户反馈「UI还是不行」，并明确要求支持多主题切换。

## What Changes

- 多主题即时切换：`dark`（默认）/ `midnight` / `light` / `system`，选择持久化到 `localStorage`（`omp-desk.theme`）。
- 全部颜色经 CSS 变量（`:root` / `[data-theme]` / `prefers-color-scheme`）；`color-scheme` 跟随主题；首屏前用内联脚本设置 `data-theme` 避免闪烁。
- 视觉重设计：Cursor/Codex 风格文章可读聊天、dock 式 composer、Title Case 面板标题、会话列表行、顶栏含 Theme 控件、全宽 `#app`、状态栏不裁切模型 id。
- 窗口去掉 `maxWidth: 1200`，允许至少缩放到 1280；min 720×480。
- 保留分组模型、slash 面板、Markdown、Plan/Execute 行为；不改 omp / 不发明 RPC。

## Capabilities

### New Capabilities
- `theme-switcher`: 多主题选择、持久化、系统跟随、无闪烁应用
- `studio-visual`: Cursor 风格工作室密度与可读性（聊天、composer、面板、顶栏、状态栏）

### Modified Capabilities

## Impact

- 前端：`index.html`、`src/style.css`、`src/main.ts`
- 配置：`src-tauri/tauri.conf.json`（窗口 maxWidth）
- 不修改 oh-my-pi / omp；不引入 React / Tailwind
