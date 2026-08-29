## Why

用户在 #studio 里调试 omp 会话时，需要查看/编辑会话 cwd 下的文件、做日常 Git 操作、偶尔打开文档网页，但现在只能切到外部编辑器/终端/浏览器完成，往返成本高。在壳内加一个 VS Code 风格活动栏与侧栏，把这三种高频操作收进工作室表面，保持 host-side、不碰 omp。

## What Changes

- 新增活动栏：位于 #studio 最左侧的约 40px 垂直图标栏，含 Explorer / Source Control / Browser 三个视图；图标可高亮当前视图；Sessions、Chat、Inspector 保持不变。
- 新增可折叠侧栏：约 240–280px，位于 #pane-sessions 左侧；选中 Explorer / SCM / Browser 时显示对应视图；默认 Explorer 打开；Chat 保持居中。
- Explorer 视图：会话 cwd 的递归文件树（展开/折叠目录、点击打开、显示相对路径、Refresh），加一个简单文本编辑器（等宽 textarea、tab 缩进、dirty dot、Save 按钮、Ctrl/Cmd-S），跳过超大目录 node_modules / target / dist / .git / .omp。
- Source Control 视图：Git 面板，覆盖 status（M/A/D/? 徽标）、stage、unstage、discard（须确认）、diff、commit（非空 message）、分支名 + ahead/behind、fetch、pull、push（不 force）、近期 log；不做 merge-conflict 编辑器、interactive rebase、git graph、stash UI、blame。
- Browser 视图：URL 栏 + Go + 返回；http(s) URL 在应用内 iframe 打开；「Open in system browser」复用既有 `open_url` Tauri 命令；iframe 被拦截时显示提示但仍允许系统浏览器打开。
- Rust 新增 host-side Tauri 命令（不发明 omp RPC）：`fs_list` / `fs_read`（仅文本、约 1MB 上限、拒二进制）/ `fs_write`（限制在根内），以及 `git_status` / `git_diff` / `git_stage` / `git_unstage` / `git_discard` / `git_commit` / `git_fetch` / `git_pull` / `git_push` / `git_log`（spawn git CLI，cwd = 根路径，解析 porcelain v1 与 log 格式）。根路径 = Settings `#cwd`，fallback `current_dir`；canonicalize + 前缀校验，禁止路径逃逸。
- 窗口默认尺寸改为约 1400x800，`minWidth` 900。
- 所有新命令注册进 `generate_handler` 与 `capabilities/default.json`（与既有命令镜像）。

## Capabilities

### New Capabilities

- `ide-activity-bar`: 活动栏与侧栏的布局、切换交互、折叠行为与窗口尺寸要求
- `ide-explorer`: 会话 cwd 文件树与文本编辑器（fs_* 命令及其安全约束）
- `ide-source-control`: Git 面板及其 host-side git_* 命令
- `ide-browser`: 应用内 iframe 浏览与系统浏览器打开

### Modified Capabilities

（openspec/specs 目前为空，无既有能力可修改）

## Impact

- Rust：`src-tauri/src/lib.rs`（新命令 + generate_handler）、`src-tauri/capabilities/default.json`、`src-tauri/tauri.conf.json`
- 前端：`index.html`、`src/main.ts`、`src/style.css`，新增 `src/ide.ts`、`src/ide.css`
- 不修改 /workspace/oh-my-pi 与 omp core；不新增 omp RPC；前端零新增依赖（vanilla TS/CSS，无 monaco、无 React）
- OpenSpec：本 change 目录
