# Contributing to omp-desk

Thanks for helping. omp-desk is a **desktop shell** around [`omp`](https://github.com/oh-my-pi/oh-my-pi): UI + process management only. It does not reimplement the agent.

## Package manager

Use **[Bun](https://bun.sh)**, not npm or yarn.

```bash
bun install
```

Do not commit `package-lock.json` or `node_modules`.

## Shell rules (important)

- Spawn the real agent with `omp --mode rpc-ui` (stdio JSONL RPC).
- **Never invent RPC method names.** Only use commands/events documented by omp / present in this repo’s protocol types.
- **Never edit omp / oh-my-pi core** in PRs to this repository. Fixes to the agent belong upstream.

## Pull requests

- Open PRs against **`main`**.
- Keep each PR to **one focused change**.
- Small docs-only PRs do not need an OpenSpec change. Spec-driven work lives under `openspec/` (optional for tiny doc/hygiene fixes).

## Local commands

```bash
bun install
bun run tauri dev    # Vite + Tauri window (needs omp on PATH + system deps)
bun run build        # frontend only: tsc + vite
cd src-tauri && cargo check
```

Linux GTK/WebKit packages are listed in the README. CI runs `bun run build` and `cargo check` only — not a full `tauri build`.

## Before you push

1. `bun run build` succeeds.
2. No invented RPC names; no credentials pasted into the UI or the PR.
3. You did not modify omp / oh-my-pi sources.
