# omp-desk

A Tauri 2 desktop shell around the [`omp`](https://github.com/oh-my-pi/oh-my-pi) coding agent.

omp-desk is only **UI + process management**. It spawns `omp --mode rpc-ui` and speaks its
stdlib JSONL RPC protocol. The agent, its tools, providers, LSP integration, hashline, and the
DeepSeek client all live inside `omp` — none of that is reimplemented here.

## Screenshot

Dark, dense single window: transcript · composer (Enter to send, Shift+Enter for a newline) ·
status bar · settings for the `omp` path / working directory / model.

## Requirements

- [Rust](https://rustup.rs) (the repo pins dependencies for rustc **1.85**; see below)
- [Node.js](https://nodejs.org) ≥ 20 and npm
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
npm install
npm run tauri dev      # run in dev mode (Vite dev server + Tauri window)
npm run tauri build    # produce a release bundle
```

`cargo check` alone:

```bash
cd src-tauri && cargo check
```

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
   `agent_start` / `agent_end` / `tool_execution_*` frames into a live transcript.

### Extension UI requests

Interactive extension dialogs are auto-denied so the stream never hangs: `confirm` answers
`false`, and `select` / `input` / `editor` are cancelled. Passive notifications
(`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) are ignored, and
`open_url` is opened in the system browser.

## Settings

Defaults: `omp` path `omp`, cwd `/workspace`, model `deepseek/deepseek-v4-pro`.
Model selection is stored in `localStorage` and re-applied on restart; `omp`'s own config
still owns the actual provider credentials. **Do not paste API keys here.**

## License

MIT. See [LICENSE](LICENSE).

omp-desk shells the [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) project by
[Can Bölük](https://github.com/canboluk) and [Mario "Pi" Zechner](https://github.com/badlogic)
(MIT). `omp` and its RPC protocol are their work; this app only talks to it over stdio.
