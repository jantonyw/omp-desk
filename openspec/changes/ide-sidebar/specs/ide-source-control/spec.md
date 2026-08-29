## Purpose

在侧栏提供轻量 Git 面板，覆盖日常 status / stage / unstage / discard / diff / commit / branch / fetch / pull / push / log 操作，通过 host-side 命令 spawn git CLI，不做完整 IDE 克隆。

## ADDED Requirements

### Requirement: Git 状态与分支信息

系统 SHALL 提供 git 状态命令，解析 porcelain v1 格式，返回分支名、ahead/behind 计数与带状态码（M/A/D/? 等）的文件列表。

#### Scenario: 查看状态
- **WHEN** 用户打开 Source Control 视图且根路径是 git 仓库
- **THEN** 头部显示分支名与 ahead/behind（如有上游），文件列表显示每个文件的状态徽标（M/A/D/? 等）

#### Scenario: 非 git 仓库
- **WHEN** 根路径不是 git 仓库
- **THEN** 面板显示明确提示（如「不是 git 仓库」），不崩溃

### Requirement: Stage / Unstage / Discard

系统 SHALL 提供 stage、unstage、discard 单个文件的操作；discard MUST 在前端二次确认后执行，且 MUST 不 force 任何操作。

#### Scenario: 暂存文件
- **WHEN** 用户对某文件执行 Stage
- **THEN** 该文件进入暂存区，状态刷新后徽标相应变化

#### Scenario: 丢弃前确认
- **WHEN** 用户对某文件执行 Discard
- **THEN** 前端弹出确认；确认后丢弃工作区修改（未跟踪文件则删除），取消则无变化

### Requirement: Diff 查看

系统 SHALL 提供查看文件 diff 的能力，覆盖未暂存与已暂存变更。

#### Scenario: 查看 diff
- **WHEN** 用户点击状态列表中的文件
- **THEN** 面板显示该文件的 diff 内容（含已暂存部分，如存在）

### Requirement: Commit

系统 SHALL 提供 commit 命令，消息 MUST 非空（前后空白去除后校验），非空才允许提交。

#### Scenario: 提交
- **WHEN** 用户在消息框输入非空文本并点击 Commit
- **THEN** 执行提交，成功后刷新状态与 log

#### Scenario: 空消息
- **WHEN** 消息为空或纯空白
- **THEN** 拒绝提交并提示，不执行 git commit

### Requirement: Fetch / Pull / Push

系统 SHALL 提供 fetch、pull、push 操作；push MUST 不使用 force；失败时 MUST 向 UI 展示 stderr。

#### Scenario: 远程操作
- **WHEN** 用户点击 Fetch / Pull / Push
- **THEN** 执行对应 git 命令；失败时面板显示 stderr 输出

### Requirement: 近期提交日志

系统 SHALL 提供近期提交列表（hash、作者、日期、subject），按时间倒序、数量有上限。

#### Scenario: 查看 log
- **WHEN** 用户查看 Source Control 视图
- **THEN** 显示近期提交列表（上限约 50 条）

### Requirement: 命令执行安全

系统 SHALL 以根路径为 git 命令的 cwd 执行；MUST 不拼接用户输入进 shell（参数数组传递）；网络类命令（fetch/pull/push）MUST 有超时保护。

#### Scenario: 路径与超时
- **WHEN** 执行任一 git 命令
- **THEN** cwd 为根路径，参数以数组传递不经 shell；fetch/pull/push 超时后返回错误而非永久挂起
