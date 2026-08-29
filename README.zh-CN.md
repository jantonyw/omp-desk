# omp-desk

围绕 [`omp`](https://github.com/oh-my-pi/oh-my-pi) 编程智能体构建的 Tauri 2 桌面外壳。

omp-desk **只是一个 UI + 进程管理器**。它启动 `omp --mode rpc-ui` 并与之通过 stdio 的
JSONL RPC 协议通信。智能体本身、工具、模型提供商、LSP、hashline 以及模型客户端
全部位于 `omp` 内部——本项目没有重写其中任何一部分。

English: [README.md](README.md).

## 界面

暗色、紧凑的 Codex 风格三栏工作室（默认 **1200×760**，1280×800 可用；输入框始终可见）：

- **左栏** — 会话状态、cwd、新建 / 停止
- **中栏** — 对话记录 + 输入框
- **右栏** — Changes（来自 tool 事件）、计划 Tasks、Run / Abort

顶栏：**Plan / Execute** 切换，以及**已绑定模型下拉**（`get_available_models` / `set_model`）。

## 环境要求

- [Rust](https://rustup.rs)（仓库为 rustc **1.85** 锁定了依赖版本，见下文）
- [Bun](https://bun.sh)（包管理器，不用 npm）
- `omp` 已在 `PATH` 中（或在设置里填写绝对路径）

### Linux 系统依赖

Tauri 2 依赖 GTK3 + WebKitGTK。Debian/Ubuntu：

```bash
sudo apt install pkg-config libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

Fedora：

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel pkgconf openssl-devel
```

（Arch：`webkit2gtk-4.1 base-devel`。Windows/macOS 无需额外系统库。）

## 构建与运行

```bash
bun install
bun run tauri dev      # Vite + Tauri 窗口
bun run tauri build    # 发布产物
bun run build          # 仅前端（tsc + vite）
```

单独的 `cargo check`：

```bash
cd src-tauri && cargo check
```

## 模型选择

会话 **ready** 后，外壳调用真实 RPC `get_available_models` 填充下拉框；选中后发送
`set_model`（`provider` + `modelId`）。空选项表示**启动时不加 `--model`**，沿用
`~/.omp` / agent 配置。请勿把 API 密钥粘贴进 omp-desk。

## Plan / Execute

- **Plan** — 以只读规划指令发送 prompt，步骤解析到右侧 Tasks。omp CLI 另有
  `--plan <model>`（规划模型）与 `--plan-yolo`（无头：规划→自动批准→执行）；需要时可在
  Settings → extra args 传入。rpc-types.ts 中没有可臆造的 `plan_mode` 命令。
- **Execute** — 有计划后点 **Confirm execute**（或在 Execute 模式下发送）；外壳会先确认，
  再通过 `prompt` / `abort_and_prompt` 把计划交回 omp 执行。

## 关于 Rust 工具链的说明

`omp-desk` 使用 **rustc 1.85** 构建。Tauri 2.11 的 semver 范围原本会拉入要求
rustc 1.87/1.88 的传递依赖版本（`time 0.3.55`、`plist 1.10`、`serde_with 3.22`、
`darling 0.23`、`idna_adapter 1.2` 以及 `icu_*` 依赖链）。`src-tauri/Cargo.toml`
中的锁定将这些 crate 固定在兼容 MSRV 的版本：

```toml
time         = "=0.3.36"
plist        = "=1.7.0"
serde_with   = "=3.9.0"
darling      = "=0.20.10"
idna         = "=1.0.3"
idna_adapter = "=1.0.0"
```

若使用更新的工具链并愿意，可移除这些锁定；它们仅为保证 1.85 构建通过。

## 工作原理

1. Rust 宿主（`src-tauri/src/process.rs`）以管道 stdio 并 `kill_on_drop` 启动
   `omp --mode rpc-ui`。
2. 每条 stdout 帧解码（协议 v1 JSONL，或 v2 base64 `rpc_chunk` 重组，并像
   `rpc-frame.ts` 那样校验 `chunkId`/`index`/`count`/`byteLength`），并以带解析后
   `kind` 的 Tauri `rpc_event` 转发给窗口
   （`ready` | `response` | `event` | `extension_ui_request` | `protocol_error` | `stderr` | `exited`）。
3. Tauri 命令桥接 UI 与子进程：`start_session`、`send_prompt`、`abort`、
   `send_command`、`get_status`、`stop_session`、`respond_extension_ui`、`open_url`。
4. 窗口（`src/main.ts` + `src/client.ts`）将 `message_update` / `agent_start` /
   `agent_end` / `tool_execution_*` 帧归约为实时对话、Changes 列表与计划 Tasks。

### 扩展 UI 请求

交互式扩展对话框会被自动拒绝以免流阻塞：`confirm` 回复 `false`，`select` / `input` /
`editor` 被取消。被动通知（`notify`、`setStatus`、`setWidget`、`setTitle`、
`set_editor_text`）被忽略，`open_url` 则在系统浏览器中打开。

## 设置

默认值：`omp` 路径为 `omp`，cwd 为 `/workspace`，模型为空（沿用本地 `omp` CLI
配置的模型）。
当 `/workspace` 不存在时（典型的 macOS/Windows 桌面环境），cwd 会回退到用户主目录，
无需改设置即可启动。模型选择保存在 `localStorage` 中并在重启时重新应用；`omp` 自身的
配置仍持有实际的提供商凭据与模型角色（`~/.omp/agent/config.yml`）。
**请勿将 API 密钥粘贴到此处。**

## 许可证

MIT。见 [LICENSE](LICENSE)。

omp-desk 是 [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) 项目的桌面外壳，该项目由
[Can Bölük](https://github.com/canboluk) 与 [Mario "Pi" Zechner](https://github.com/badlogic)
（MIT）编写。`omp` 及其 RPC 协议是他们的成果；本应用仅通过 stdio 与之对话。
