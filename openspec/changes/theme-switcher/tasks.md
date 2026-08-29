## 1. OpenSpec

- [x] 1.1 新增 openspec/changes/theme-switcher（proposal/design/tasks + theme-switcher / studio-visual specs）

## 2. Theme system

- [x] 2.1 CSS：`:root` 与 `[data-theme]`（dark/midnight/light）及 system 的 prefers-color-scheme 完整 token；`color-scheme` 匹配
- [x] 2.2 index.html 内联脚本在首屏前设置 `data-theme`；顶栏 Theme `<select>`；localStorage `omp-desk.theme` 读写与即时切换

## 3. Studio visual

- [x] 3.1 聊天：助手文章排版（md h1–h3、列表、代码块）；用户气泡卡片；句式大小写角色名 + 小圆点
- [x] 3.2 Composer：圆角 dock / input well；Send primary pill；Abort ghost；slash 叠在 well 上方
- [x] 3.3 面板 Title Case、会话列表行、8px 密度/圆角、1px token 边框；全宽 `#app`；状态栏单行不裁切模型 id
- [x] 3.4 顶栏：brand + Plan/Execute + model（optgroup 保留、不 ellipsis）+ Theme + Settings；按钮 pointer/focus/hover

## 4. Window

- [x] 4.1 tauri.conf.json 去掉 maxWidth:1200；保留 min 720×480、默认 1200×760，可缩放到 ≥1280

## 5. Verify

- [x] 5.1 bun run build 通过
- [x] 5.2 若改 Rust 则 cargo check（本 change 仅 tauri.conf.json）
- [x] 5.3 打开堆叠 PR（基线 cursor/studio-ui-polish-6c01），不合并
