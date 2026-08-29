## Context

omp-desk 是 Tauri 2 + Vanilla TS/CSS 外壳。`studio-ui-polish` 已落地模型分组、slash、Markdown，但视觉仍偏终端，且仅暗色 zinc。本 change 在该分支之上叠加主题系统与工作室视觉。

## Goals / Non-Goals

**Goals:**
- Dark / Midnight / Light / System 四主题，即时切换并持久化
- CSS 变量驱动全部颜色；`color-scheme` 匹配；首屏无闪烁
- 聊天文章化、用户气泡卡片化、composer dock、面板 Title Case、全宽布局
- 保留 Plan/Execute、optgroup 模型、slash、Markdown

**Non-Goals:**
- 不改 omp / oh-my-pi
- 不引入 React / Tailwind / 新 RPC
- 不合并既有 PR；本 change 独立堆叠 PR

## Decisions

1. **主题存储**：`localStorage['omp-desk.theme']`，合法值 `dark|midnight|light|system`；非法或缺失回退 `dark`。
2. **应用方式**：`<html data-theme="...">`；`system` 用 `@media (prefers-color-scheme)` 映射到 dark/light token；另监听 `matchMedia` 以便 OS 切换时即时更新（若选 system）。
3. **FOUC**：`index.html` `<head>` 内联极短脚本：读 localStorage → 设 `data-theme` + `color-scheme`（system 时按 matchMedia 设 color-scheme）。
4. **控件**：顶栏 Settings 旁 compact `<select id="theme-select">`（Dark / Midnight / Light / System）。
5. **Token 表**：
   - dark：bg `#0c0c0e` / elev `#18181b`，fg `#f4f4f5`，accent sky
   - midnight：bg `#09090b` / elev `#111113`，略冷 accent
   - light：bg `#ffffff` / elev `#f4f4f5`，fg `#18181b`，同系 accent，对比 ≥4.5:1
6. **视觉**：去掉 ALL-CAPS role；用户/助手用小圆点 + 句式大小写名；composer 圆角 10–12px input well；Send 为 primary pill；`#app` 去掉 max-width:1200；窗口去掉 maxWidth。
7. **字体**：UI Inter/system-ui；代码 ui-monospace；chat 14px / line-height ~1.55。

## Risks / Trade-offs

- 原生 `<select>` 在部分平台上仍受 OS 样式限制；通过 `color-scheme` 与暗/亮背景尽量对齐。
- Light 主题需全面审计硬编码暗色；全部颜色走变量可降低回归。

## Migration Plan

首次加载无 theme key → `dark`。旧 UI key / settings 不变。
