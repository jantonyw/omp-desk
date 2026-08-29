## 1. Bound model picker

- [ ] 1.1 在 protocol.ts 补齐 get_available_models / set_model / cycle_model 类型，字段与 oh-my-pi rpc-types.ts 一致
- [ ] 1.2 前端在 ready 后调用 get_available_models 并缓存列表
- [ ] 1.3 模型输入换成下拉：列出已绑定模型，选中后 set_model；保留跟随 omp 默认的空选项
- [ ] 1.4 状态栏显示当前模型；失败时保留原模型并提示错误

## 2. Plan then execute

- [ ] 2.1 对照 rpc-types.ts 与 omp --help 确认 plan / plan-yolo 的真实调用方式，写进实现（禁止猜命令名）
- [ ] 2.2 顶栏增加 Plan / Execute 切换；Plan 下发送的 prompt 走规划路径
- [ ] 2.3 Execute 仅在用户确认后触发，把计划交回 omp 执行
- [ ] 2.4 将计划步骤渲染到右侧任务列表

## 3. Studio three-pane UI

- [ ] 3.1 index.html 与 style.css 改为左会话 / 中对话 / 右检查器；默认窗口不超过 1200x760，composer 始终可见
- [ ] 3.2 左栏：会话状态、New session、当前 cwd
- [ ] 3.3 右栏：Changes（从 tool 事件收集路径）加任务清单加运行/中止
- [ ] 3.4 暗色密集风格，不引入新 UI 框架

## 4. Verify

- [ ] 4.1 bun run build 通过
- [ ] 4.2 src-tauri 下 cargo check 通过
- [ ] 4.3 用真实 omp --mode rpc-ui 冒烟：列出绑定模型、切换模型、Plan 一轮再 Execute
- [ ] 4.4 README 中英说明 bun、模型选择、Plan/Execute；注明仍是 omp 外壳
