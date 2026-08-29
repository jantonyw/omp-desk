## Context

现状：`#studio` 是 3 列 CSS grid（`--left-w` 200px / `minmax(0,1fr)` / `--right-w` 248px，`style.css:449-456`）；前端为 vanilla TS（`src/main.ts` + `src/client.ts` + `src/style.css`），所有 invoke 走 `@tauri-apps/api/core`；Rust 侧仅 `src-tauri/src/lib.rs`（session 命令 + `open_url`）与 `process.rs`、`event_bridge.rs`，无 fs/dialog/process 插件，只有 `tauri-plugin-shell`。Settings（含 `#cwd`）由前端持久化在 `localStorage["omp-desk.settings"]`，Rust 侧没有读取 settings 的命令。MSRV 1.85（`rust-toolchain.toml`），Cargo 依赖被刻意 pin（`Cargo.toml:30-35`），不得新增需更高 rustc 的依赖。动因见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- 全部能力落在 host-side（Rust 命令 + webview），不碰 omp RPC 与 oh-my-pi
- 新命令零新增依赖：`std::fs` + `tokio::process`（tokio features 已含 process）
- 前端零新增依赖：vanilla TS/CSS，无 monaco / React / Tailwind
- 路径安全为硬约束：canonicalize + 前缀校验，任何越界直接拒绝

**Non-Goals:**
- 不做 merge-conflict 编辑器、interactive rebase、git graph、stash UI、blame
- 不做多标签编辑、语法高亮、二进制预览、文件重命名/删除 UI
- 不把 settings 持久化挪到 Rust；cwd 仍由前端读取后作为参数传入命令

## Decisions

1. **命令签名统一带 `root` 参数，Rust 兜底 fallback**：前端从 Settings `#cwd` 取根路径，传给每个 fs_*/git_* 命令；`root` 为空字符串时 Rust 回退 `std::env::current_dir()`。这样「Settings #cwd，fallback current_dir」在 host-side 落地，且无需新增「读 settings」的桥接命令。所有命令沿用既有 `CmdResult = Result<serde_json::Value, String>`（`lib.rs:37`）。
   - 备选：前端自行 fallback（前端不知道 Rust 进程 cwd）→ 弃用；新增 `get_settings` 命令 → 引入 Rust 读 localStorage 的复杂度，弃用。

2. **路径安全模式（Rust 内聚一个 helper）**：`resolve_under(root, rel)` —— root canonicalize 后，对目标做 `root.join(rel)` 再 canonicalize，`starts_with(root)` 校验；`fs_write` 的文件可能不存在，改为 canonicalize 父目录 + 拼接文件名再前缀校验。任何失败/越界返回 `Err` 且不落盘。所有 git 命令的 cwd 一律设为 root 本身。
   - 备选：直接 `root.join(rel)` 不用 canonicalize → 防不了 symlink 逃逸，弃用。

3. **`fs_list` 返回嵌套树 + 防御性上限**：`std::fs::read_dir` 递归，按目录名跳过 `node_modules/target/dist/.git/.omp`；symlink 目录不跟随（防环）；条目总数上限 5000，超出截断并在结果里带 `truncated: true`。返回相对路径（`/` 分隔）+ `kind`。前端做懒展开（本地渲染），不需要懒加载 RPC。
   - 备选：平铺列表 + 每次展开再请求 → 更多往返、树状态复杂，弃用。

4. **`fs_read` 文本判定**：先看 metadata len ≤ 1MiB，再读 bytes，`String::from_utf8` 失败或含 NUL 即判二进制拒绝。`fs_write` 为 `{root, path, content}` 直写。
   - 备选：按扩展名白名单判文本 → 会误伤无扩展名脚本/配置，弃用。

5. **Git 全部经 `tokio::process::Command`，参数数组、`kill_on_drop(true)`，网络类命令 `tokio::time::timeout` 120s**。解析：`git_status` 用 `git status --porcelain=v1 -b`（`##` 头解析分支 + `[ahead N, behind M]`；条目取 XY + 路径，rename 行 `->` 取右路径）；`git_diff` 同时跑 `git diff -- <path>` 与 `git diff --cached -- <path>` 返回 `{unstaged, staged}`；`git_log` 用 `-n 50 --pretty=format:%h%x1e%an%x1e%ad%x1e%s --date=short`（`\x1e` 分隔）。失败时把 stderr 拼进 `Err` 字符串给 UI 展示。
   - `git_discard`：前端传 `untracked` 布尔；untracked → `std::fs::remove_file`，tracked → `git restore -- <path>`（失败 fallback `git checkout -- <path>`）。
   - `git_unstage`：`git reset -q HEAD -- <path>`；无 HEAD 的新仓库会失败 → fallback `git rm -r --cached -- <path>`。
   - 备选：用 git2 crate → 新增依赖且需匹配 1.85 工具链，违反「零新增依赖」，弃用。

6. **前端结构**：`index.html` 在 `#pane-sessions` 前插 `<nav id="activity-bar">`（3 个按钮，内联 SVG 图标，`title` 为 Explorer / Source Control / Browser）与 `<aside id="pane-side">`（内含 `#view-explorer` / `#view-scm` / `#view-browser` 三个 section，默认 explorer 显示）。`#studio` grid 改为 `var(--bar-w) var(--side-w) var(--left-w) minmax(0,1fr) var(--right-w)`，新根变量 `--bar-w: 44px; --side-w: 260px`；折叠 = `#studio.side-closed` 去掉侧栏列并 `display:none`。激活图标用 `--accent` 高亮，全部颜色复用既有 CSS 变量（四主题自动适配）。≤960px 时保留现有 inspector 隐藏行为，侧栏仍由用户控制（因 minWidth 900 < 960，自动折叠会让侧栏在最小窗口宽度下永久不可用）。
   - 备选：绝对定位悬浮侧栏 → 会遮挡 Chat，违背「Chat 居中」，弃用；≤960px 自动折叠 → 与 minWidth 900 冲突，弃用。

7. **新文件 `src/ide.ts` + `src/ide.css`**，`main.ts` 只加一行 `import { initIde } from './ide'` + 调用（及 ide.css import，与 style.css 的引入方式保持一致）。ide.ts 自己 import `invoke`，client.ts 不动（其职责是 omp 会话通道）。
   - 备选：把 wrapper 塞进 client.ts → 与「client = RPC 传输层」的边界不符，弃用。

8. **编辑器**：侧栏内 `<textarea>`（等宽字体），Tab 插入缩进（preventDefault），dirty = 当前内容 ≠ 最后保存内容，文件名头显示 dirty dot，Save 按钮 + Ctrl/Cmd-S，clean 时 Save disabled。树占上 40%、编辑器在下。

9. **SCM 面板**：header（分支 + ahead/behind）→ 变更文件列表（`M/A/D/?` 徽标，点击显示 diff）→ 选中文件的 Stage/Unstage/Discard（Discard 用既有交互风格做 confirm）→ commit textarea + Commit（trim 后空则 disabled + 提示）→ Fetch/Pull/Push 按钮行（stderr 显示在面板日志区）→ Recent commits 列表。布局为纵向 section 堆叠，适配 260px 宽度。

10. **Browser 面板**：URL input + Go（Enter 同效）+ Back + 「Open in system browser」（复用既有 `open_url` invoke wrapper）；无 scheme 补全 `https://`；iframe 加载，Go 后启动定时器监听 load 事件，超时未 load 显示「该站点可能禁止内嵌，请用系统浏览器打开」提示（跨域下无法读 iframe 内容，只能时间探测）。

11. **ACL**：Tauri 2 中应用自定义命令不受 capability 权限门控（ACL 只管插件/核心命令），故 `capabilities/default.json` 预期无需改动；若运行时报 command not allowed 再按既有格式补条目。`open_url` 原样复用。

12. **窗口**：`tauri.conf.json` 改 `width: 1400, height: 800, minWidth: 900`（minHeight 不动）。

## Risks / Trade-offs

- [递归目录很大（非 node_modules 类）] → 条目上限 5000 + `truncated` 标记，UI 提示用 Refresh/子目录导航。
- [git pull 遇到合并冲突或需交互] → 命令返回非零 + stderr 展示；冲突解决不在范围内（Non-Goals），用户可去终端处理。
- [260px 编辑器窄] → 等宽小字号 + 换行开关不做；接受窄屏快速编辑定位，重度编辑留给外部工具。
- [iframe 站点拒绝内嵌且跨域探测不可靠] → 静态提示 + 恒可用的系统浏览器按钮兜底。
- [git 仓库含超大 diff] → `git diff` 单文件输出截断到 ~200KB 返回，UI 显示截断提示。

## Migration Plan

无数据迁移；纯增量 UI + 命令。回滚 = 弃用分支。主题 key / settings 格式 / RPC 通道均不变。

## Post-implementation fixes

- **`fs_write` symlink 逃逸**：原实现只 canonicalize 父目录 + 拼回文件名，若目标文件本身是 root 内 symlink，`fs::write` 会跟随写到 root 外。修复：目标已存在时（`symlink_metadata` 命中，含 symlink）对完整路径 canonicalize + `starts_with(root)` 校验，越界返回 `path escapes root`；目标在 root 内则写到 canonical 目标。目标不存在时仍用「canonicalize 父目录 + 拼文件名」（新文件名不可能是 symlink）。
- **untracked diff 不显示**：`git diff --no-index` 在两个文件不同时 exit 1 且 diff 在 stdout，原 `run_git` 视一切非零为 Err，diff 被丢弃。修复：diff 类命令走 `run_git_diff` —— exit 1 且 stdout 非空视为成功；exit 0 仍成功；其余非零（含 exit 1 且 stdout 为空）仍按 stderr 报错。
