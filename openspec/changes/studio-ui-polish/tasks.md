## 1. OpenSpec + deps

- [x] 1.1 新增 openspec/changes/studio-ui-polish（proposal/design/tasks + specs）
- [x] 1.2 bun add marked 与 sanitizer；保持 beforeDevCommand 为 bun run dev

## 2. Model groups

- [x] 2.1 renderModelSelect 按 provider 使用 optgroup；保留 omp default 空选项
- [x] 2.2 若有角色信息则标注；状态栏/顶栏显示完整 provider/id，CSS 不 ellipsis 裁切

## 3. Command composer

- [x] 3.1 protocol.ts 增加 get_available_commands 与 RpcAvailableSlashCommand / available_commands_update
- [x] 3.2 client 在 ready 后拉取命令并缓存；处理 available_commands_update
- [x] 3.3 composer `/` 可过滤面板；方向键 + Enter 插入；发送走 prompt / abort_and_prompt；slash 跳过 Plan 前缀

## 4. Markdown + plan echo + density

- [x] 4.1 助手消息 Markdown 渲染并 sanitize；用户气泡保持转义
- [x] 4.2 TASKS 去掉 markdown 强调；Plan 回显不产生重复 YOU 气泡
- [x] 4.3 密集暗色布局适配 ~1200×760；message_count 从 get_state / 发送 / 会话事件更新

## 5. Verify

- [x] 5.1 bun run build 通过
- [x] 5.2 若改 Rust则 cargo check 通过
- [x] 5.3 打开 PR（不合并）
