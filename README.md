# omp-desk

[![CI](https://github.com/jantonyw/omp-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/jantonyw/omp-desk/actions)

A Tauri 2 desktop shell around the [`omp`](https://github.com/oh-my-pi/oh-my-pi) coding agent.

omp-desk is only **UI + process management**. It spawns `omp --mode rpc-ui` and speaks its
stdio JSONL RPC protocol. The agent, its tools, providers, LSP integration, hashline, and the
model client all live inside `omp` — none of that is reimplemented here.

中文说明见 [README.zh-CN.md](README.zh-CN.md)。

## Screenshot / UI

Chat-first three-pane studio (default **1200×760**; composer always reachable):

- **Left** — session row (status, cwd), New chat / Stop
- **Center** — Plan/Execute **underline tabs**, welcome or markdown transcript, composer
- **Right** — Changes (from tool events), plan Tasks, Confirm execute, Run actions

Top bar: **model chips/tabs** from `get_available_models` / `set_model` (dropdown fallback),
and a **theme** control: Dark / Midnight / Light / System.

Composer: type **`/`** for a filterable slash-command palette (`get_available_commands`).
Assistant turns render as **markdown**. Long sessions keep **memory caps** (transcript ≈200
user/assistant/tool entries; Changes ≈100) so the WebView does not grow without bound.

## Requirements

- [Rust](https://rustup.rs) (the repo pins dependencies for rustc **1.85**; see below)
- [Bun](https://bun.sh) (package manager — not npm)
- `omp` on your `PATH` (or point the settings at an absolute path)

### Linux system dependencies

Tauri 2 needs GTK3 + WebKitGTK. On Debian/Ubuntu:

```bash
sudo apt install pkg-config libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

On Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel pkgconf openssl-devel
```

(Arch: `webkit2gtk-4.1 base-devel`. Windows/macOS need no extra system libs.)

## Build & run

```bash
bun install
bun run tauri dev      # Vite + Tauri window
bun run tauri build    # release bundle
bun run build          # frontend only (tsc + vite)
```

`cargo check` alone:

```bash
cd src-tauri && cargo check
```

CI ([Actions](https://github.com/jantonyw/omp-desk/actions)) runs `bun run build` and
`cargo check` — not a full Tauri bundle.

## Models

After the session is **ready**, the shell calls real RPC `get_available_models` and fills the
model chips. Picking a model sends `set_model` with `{ provider, modelId }`. An empty selection
means **omit `--model` on spawn** so `omp` uses `~/.omp` / agent config. Do not paste API keys
into omp-desk.

## Plan / Execute

- **Plan** — prompts are sent with a read-only planning instruction; steps are parsed into the
  right-hand Tasks list. omp CLI also exposes `--plan <model>` (plan model) and `--plan-yolo`
  (headless plan→auto-approve→execute); pass those via Settings → extra args if you need them.
  There is no inventable RPC `plan_mode` command — see `src/protocol.ts`.
- **Execute** — use **Confirm execute** (or send while in Execute mode) after a plan exists;
  the shell asks for confirmation, then sends a follow-up via `prompt` / `abort_and_prompt`.

## Contributing & security

- [CONTRIBUTING.md](CONTRIBUTING.md) — bun, shell-only rules, PR expectations
- [SECURITY.md](SECURITY.md) — credentials live in omp/`~/.omp`; how to report vulns
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

OpenSpec plans live under `openspec/` (optional for small docs-only PRs).

## A note on the Rust toolchain

`omp-desk` builds with **rustc 1.85**. Tauri 2.11's semver ranges otherwise pull in
transitive versions (`time 0.3.55`, `plist 1.10`, `serde_with 3.22`, `darling 0.23`,
`idna_adapter 1.2` and the `icu_*` chain) that require rustc 1.87/1.88. The pins in
`src-tauri/Cargo.toml` hold those crates at MSRV-compatible releases:

```toml
time        = "=0.3.36"
plist       = "=1.7.0"
serde_with  = "=3.9.0"
darling     = "=0.20.10"
idna        = "=1.0.3"
idna_adapter = "=1.0.0"
```

With a newer toolchain you may drop these pins if you prefer; they are load-bearing only
to keep the 1.85 build green.

## How it works

1. The Rust host (`src-tauri/src/process.rs`) spawns `omp --mode rpc-ui` with piped
   stdin/stdout/stderr and `kill_on_drop`.
2. Every stdout frame is decoded (protocol v1 JSONL, or v2 base64 `rpc_chunk` reassembly
   that validates `chunkId`/`index`/`count`/`byteLength` like `rpc-frame.ts`) and forwarded
   to the window as a Tauri `rpc_event` with a resolved `kind`
   (`ready` | `response` | `event` | `extension_ui_request` | `protocol_error` | `stderr` | `exited`).
3. Tauri commands bridge the UI to the child: `start_session`, `send_prompt`, `abort`,
   `send_command`, `get_status`, `stop_session`, `respond_extension_ui`, `open_url`.
4. The window (`src/main.ts` + `src/client.ts`) reduces `message_update` /
   `agent_start` / `agent_end` / `tool_execution_*` frames into a live transcript, Changes
   list, and plan Tasks.

### Extension UI requests

Interactive extension dialogs are auto-denied so the stream never hangs: `confirm` answers
`false`, and `select` / `input` / `editor` are cancelled. Passive notifications
(`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) are ignored, and
`open_url` is opened in the system browser.

## Settings

Defaults: `omp` path `omp`, cwd `/workspace`, model empty (defer to the local
`omp` CLI's configured model).
When `/workspace` does not exist (typical macOS/Windows desktops), the cwd
falls back to the user's home directory so the app starts without editing
settings. Model selection is stored in `localStorage` and re-applied on
restart; `omp`'s own config still owns the actual provider credentials and
model roles (`~/.omp/agent/config.yml`). **Do not paste API keys here.**

## License

MIT. See [LICENSE](LICENSE).

omp-desk shells the [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) project by
[Can Bölük](https://github.com/canboluk) and [Mario "Pi" Zechner](https://github.com/badlogic)
(MIT). `omp` and its RPC protocol are their work; this app only talks to it over stdio.
