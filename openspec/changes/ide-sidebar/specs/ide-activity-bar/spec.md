## Purpose

在 #studio 最左侧提供 VS Code 风格的活动栏与可折叠侧栏，承载 Explorer / Source Control / Browser 三个视图，同时保留 Sessions、Chat、Inspector 的既有布局与交互。

## ADDED Requirements

### Requirement: 活动栏位于工作室最左侧

系统 SHALL 在 #studio 最左侧渲染一条约 40px 的垂直活动栏，包含 Explorer、Source Control、Browser 三个图标按钮，且位于 #pane-sessions 左侧。

#### Scenario: 活动栏初始渲染
- **WHEN** 应用加载完成
- **THEN** #studio 最左侧显示约 40px 宽的活动栏，含 Explorer / Source Control / Browser 三个垂直图标按钮，均有对应 title

### Requirement: 活动栏视图切换与高亮

系统 SHALL 支持点击活动栏图标切换侧栏视图；当前激活视图的图标 MUST 高亮；再次点击当前激活图标时侧栏折叠/展开。

#### Scenario: 切换视图
- **WHEN** 用户点击 Source Control 图标
- **THEN** 侧栏显示 Source Control 视图，且该图标高亮，Explorer 图标取消高亮

#### Scenario: 折叠与展开
- **WHEN** 用户点击当前已激活的图标（如默认激活的 Explorer）
- **THEN** 侧栏折叠；再次点击同一图标时侧栏重新展开并显示该视图

### Requirement: 默认视图与侧栏尺寸

系统 SHALL 默认打开 Explorer 视图；侧栏宽度 MUST 在约 240–280px 范围内，且可折叠；侧栏 MUST 位于 #pane-sessions 左侧，Chat 保持居中不被遮挡。

#### Scenario: 默认状态
- **WHEN** 应用加载完成
- **THEN** 侧栏展开并显示 Explorer 视图，宽度在 240–280px 之间，位于 Sessions 面板左侧

### Requirement: 会话与聊天功能不受影响

系统 SHALL 保持 Sessions、Chat、Inspector 面板及其交互（composer Enter 发送、slash palette、模型 chips、Plan/Execute、markdown 渲染、流式补丁、omp 会话启动）与活动栏并存且行为不变。

#### Scenario: 既有交互回归
- **WHEN** 活动栏与侧栏存在时用户使用 composer Enter 发送、`/` slash palette、模型 chips、Plan/Execute
- **THEN** 上述交互行为与未加活动栏时一致

### Requirement: 窗口默认尺寸

系统 SHALL 将默认窗口尺寸设为约 1400x800，且 minWidth 为 900。

#### Scenario: 默认窗口
- **WHEN** 应用以默认配置启动
- **THEN** 窗口约为 1400x800，用户无法将宽度缩至 900 以下

### Requirement: 主题适配

系统 SHALL 使活动栏与侧栏在 Dark / Midnight / Light / System 四主题下均正确渲染，通过既有 data-theme 机制适配。

#### Scenario: 主题切换
- **WHEN** 用户在四主题间切换
- **THEN** 活动栏与侧栏颜色随 data-theme 正确变化，无不可读的对比度问题
