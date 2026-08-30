## Purpose

在工作区/会话侧边栏提供可见的智能体集合，让用户一键把 omp 内置任务代理的 spawn 指令插入 composer，无需手写 prompt 即可调用侦察、检索、审查、设计、安全审查专家代理。

## ADDED Requirements

### Requirement: 侧边栏展示内置任务代理花名册

系统 SHALL 在工作区/会话侧边栏展示 omp 内置的五个任务代理，每行同时显示短中文标签与英文名：scout 侦察、librarian 检索、reviewer 审查、designer 设计、security-reviewer 安全审查。

#### Scenario: 花名册可见

- **WHEN** 用户打开工作区/会话侧边栏
- **THEN** 可见「智能体」区块列出上述五个代理，中文标签与英文名同时显示

#### Scenario: 花名册不受会话状态影响

- **WHEN** omp 会话未启动或正在 streaming
- **THEN** 花名册仍然可见且可点击

### Requirement: 优先驱动 omp 暴露的 agents 命令

系统 SHALL 复用既有 RPC `get_available_commands`（含 `available_commands_update` 帧）获取命令列表；当列表中存在名为 `agents` 的命令（或其别名）时，智能体集合 SHALL 展示一个「Agents Hub」入口并优先驱动该命令。

#### Scenario: 发现 agents 命令

- **WHEN** 命令列表中包含 `/agents` 命令
- **THEN** 智能体集合顶部展示「Agents Hub」入口，点击后向 composer 插入该命令文本

#### Scenario: 命令列表延迟到达

- **WHEN** 命令列表尚未加载完成或为空
- **THEN** 五个内置代理花名册仍然展示，仅「Agents Hub」入口暂不出现

#### Scenario: 命令列表动态更新

- **WHEN** omp 推送新的 `available_commands_update` 帧
- **THEN** 智能体集合中的命令入口随新列表刷新

### Requirement: 点击代理插入 spawn 指令

点击代理行 SHALL 不直接发送消息，而是向 composer 插入一条清晰的、要求 omp 以 `task` 工具启动对应任务代理的自然语言指令前缀，并让 composer 获得焦点。

#### Scenario: 插入指令前缀

- **WHEN** 用户点击「scout 侦察」行
- **THEN** composer 内容被替换/追加为包含 `scout` 代理名与任务占位的中文 spawn 指令前缀，光标聚焦 composer，消息未自动发送

#### Scenario: 追加已有草稿

- **WHEN** composer 已有未发送文本且用户点击代理行
- **THEN** 插入行为不静默丢弃已有草稿（保留或明确覆盖策略一致）

### Requirement: 不新增 RPC 与子进程

系统 SHALL NOT 引入新的 Rust RPC 方法或新的 RPC 命令名，SHALL NOT 自行 spawn 子进程；智能体调用 SHALL 仅通过既有 `prompt` / `steer` / `follow_up` 等已支持命令携带自然语言指令实现。

#### Scenario: 复用既有通道

- **WHEN** 用户发送由代理点击插入的指令
- **THEN** 消息经既有 prompt 类 RPC 命令发给 omp，由 omp 自行决定如何启动任务代理
