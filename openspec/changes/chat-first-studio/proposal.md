## Why

Theme switcher (PR #4) 已有 Dark/Midnight/Light/System，但模型切换仍是原生 `<select>`，空会话像日志 dump，Sessions/Inspector 偏调试卡片。参考 8.AI 聊天优先空态 + Boop 列表行语言，把工作室表面改成轻量、留白、chip/tab 驱动，同时保留全部 rpc-ui 能力。

## What Changes

- 模型切换：`get_available_models` 后渲染可横向滚动的 chip/tab 行；激活项为填充 pill；点击发既有 `set_model`；「omp default」为首 chip；`<select>` 仅作隐藏 fallback / More。
- 空态聊天：无 user/assistant 消息时居中欢迎 + 宽圆角 composer well；首条消息后 composer 贴底；左侧 `/` 按钮插入 slash；右侧圆形 Send；Abort 为 ghost。
- Sessions / Inspector：Boop 风格行（状态 pill、描述、meta）；「New chat」主按钮；Changes/Tasks 为 kind + path/title + status pill；空态一行安静文案。
- Plan/Execute：下划线 tab 或紧凑分段，保留行为。
- Light 对齐 8.AI/Boop（白底、软边、12–16px 圆角）；Dark/Midnight 同布局；主题选择器与 Settings 保留；状态栏更安静（pid 进 tooltip）。

## Capabilities

### New Capabilities
- `model-tabs`: 水平模型 chip/tab，替代原生 select 作为主 UX
- `chat-empty-state`: 无消息时的居中欢迎 + 居中 composer
- `boop-rows`: Sessions / Changes / Tasks 列表行语言
- `studio-surface`: Light-first 留白与全主题同布局 chrome

### Modified Capabilities

## Impact

- 前端：`index.html`、`src/style.css`、`src/main.ts`
- OpenSpec：本 change 目录
- 不修改 oh-my-pi / omp；不引入 React / Tailwind；不发明新 RPC
