## 1. Rust：fs 命令与路径安全

- [x] 1.1 在 src-tauri/src/lib.rs 新增 `resolve_under(root, rel)` helper：root canonicalize（空则 `current_dir` fallback），目标 join 后 canonicalize 并 `starts_with(root)` 前缀校验；越界返回 Err。验证：cargo check 通过
- [x] 1.2 实现 `fs_list {root}`：递归 read_dir，按名跳过 node_modules/target/dist/.git/.omp，symlink 目录不跟随，5000 条上限 + `truncated` 标记，返回嵌套树（相对路径 + kind）。验证：cargo check 通过
- [x] 1.3 实现 `fs_read {root, path}`：metadata ≤1MiB，UTF-8 解码失败或含 NUL 判二进制拒绝。验证：cargo check 通过
- [x] 1.4 实现 `fs_write {root, path, content}`：canonicalize 父目录 + 拼接文件名后前缀校验，越界拒绝不落盘。验证：cargo check 通过
- [x] 1.5 generate_handler 注册 fs_list/fs_read/fs_write。验证：cargo check 通过

## 2. Rust：git 命令

- [x] 2.1 实现 `git_status {root}`：`git status --porcelain=v1 -b`，解析 `##` 头（分支 + ahead/behind）与 XY + 路径（rename 行取 `->` 右侧）。验证：cargo check 通过
- [x] 2.2 实现 `git_diff {root, path}`：`git diff -- <path>` 与 `git diff --cached -- <path>`，返回 {unstaged, staged}，输出截断 ~200KB。验证：cargo check 通过
- [x] 2.3 实现 `git_stage {root, path}`（`git add -- <path>`）与 `git_unstage {root, path}`（`git reset -q HEAD --` 失败 fallback `git rm -r --cached --`）。验证：cargo check 通过
- [x] 2.4 实现 `git_discard {root, path, untracked}`：untracked 删文件，tracked `git restore --` 失败 fallback `git checkout --`。验证：cargo check 通过
- [x] 2.5 实现 `git_commit {root, message}`：trim 后非空才执行 `git commit -m <message>`，空消息返回错误。验证：cargo check 通过
- [x] 2.6 实现 `git_fetch` / `git_pull` / `git_push`：参数数组、`kill_on_drop(true)`、120s 超时、失败 stderr 进 Err、push 不带 --force。验证：cargo check 通过
- [x] 2.7 实现 `git_log {root}`：`git log -n 50 --pretty=format:%h%x1e%an%x1e%ad%x1e%s --date=short`，按 `\x1e` 解析返回数组。验证：cargo check 通过
- [x] 2.8 generate_handler 注册全部 git_* 命令。验证：cargo check 通过

## 3. 配置：窗口与 capability

- [x] 3.1 tauri.conf.json 窗口改 width 1400 / height 800 / minWidth 900。验证：JSON 有效、字段值正确
- [x] 3.2 确认 capabilities/default.json 无需为新命令增补权限（Tauri 2 应用自定义命令不受 ACL 门控）；如需则按既有格式补条目。验证：tauri dev 运行时命令可被调用

## 4. 前端：HTML/CSS 骨架

- [x] 4.1 index.html 在 #pane-sessions 前插入 `#activity-bar`（Explorer / Source Control / Browser 三个内联 SVG 图标按钮 + title）与 `#pane-side`（`#view-explorer` / `#view-scm` / `#view-browser` 三 section，默认 explorer 可见）。验证：bun run build 通过
- [x] 4.2 style.css：#studio grid 改 5 列 `var(--bar-w) var(--side-w) var(--left-w) minmax(0,1fr) var(--right-w)`，新增 `--bar-w: 44px; --side-w: 260px`；`#studio.side-closed` 侧栏列置 0；≤960px 响应式侧栏自动折叠、活动栏保留。验证：bun run build 通过
- [x] 4.3 新增 src/ide.css：活动栏、面板通用、文件树、编辑器、SCM 各 section、browser 样式，全部复用既有 CSS 变量（四主题自动适配）。验证：bun run build 通过

## 5. 前端：TS 逻辑

- [x] 5.1 新增 src/ide.ts：invoke wrapper（fs_*/git_*/open_url）+ `initIde()`；活动栏点击切换视图、激活高亮、再点当前折叠/展开；默认 Explorer 打开。验证：bun run build 通过
- [x] 5.2 Explorer：树渲染（懒展开/相对路径/Refresh/truncated 提示）+ 编辑器（等宽 textarea、Tab 插缩进、dirty dot、Save 按钮、Ctrl/Cmd-S、二进制/超大提示）。验证：bun run build 通过
- [x] 5.3 SCM：分支 + ahead/behind 头部、状态列表（M/A/D/? 徽标）、点击显示 diff、Stage/Unstage/Discard（Discard confirm）、commit textarea + Commit（空消息禁用）、Fetch/Pull/Push（stderr 展示）、近期提交列表。验证：bun run build 通过
- [x] 5.4 Browser：URL 输入 + Go（Enter 同效，无 scheme 补全 https://）+ Back + iframe + load 超时「禁止内嵌」提示 + 「Open in system browser」复用 open_url。验证：bun run build 通过
- [x] 5.5 main.ts 接入 `initIde()` 并 import ide.css（与 style.css 引入方式一致），不触碰 composer/slash/model chips/Plan-Execute/markdown 渲染路径。验证：bun run build 通过

## 6. Verify

- [x] 6.1 `bun run build` 在 /workspace/omp-desk 通过
- [x] 6.2 `cargo check` 在 /workspace/omp-desk/src-tauri 通过
- [x] 6.3 手动 smoke：描述验证步骤（活动栏切换、Explorer 打开/保存、SCM 各操作、Browser iframe 与系统浏览器、四主题、既有聊天交互无回归）
