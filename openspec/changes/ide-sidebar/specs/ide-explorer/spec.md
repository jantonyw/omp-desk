## Purpose

提供会话 cwd 的递归文件树浏览与简单文本编辑能力，通过 host-side Tauri 命令读写文件，支持保存与快捷键。

## ADDED Requirements

### Requirement: 根路径解析

系统 SHALL 以 Settings `#cwd` 为根路径，为空时回退到进程当前目录；所有文件操作 MUST 以该根路径为界。

#### Scenario: cwd 为空时回退
- **WHEN** Settings `#cwd` 为空
- **THEN** 根路径为进程当前目录

#### Scenario: cwd 有效
- **WHEN** Settings `#cwd` 指向存在的目录
- **THEN** 根路径为该目录

### Requirement: 路径逃逸防护

系统 SHALL canonicalize 目标路径并校验其前缀属于根路径；任何越界访问 MUST 被拒绝并返回错误，不执行读写。

#### Scenario: 越界读取
- **WHEN** 请求路径包含 `..` 或符号链接逃逸至根路径之外
- **THEN** 命令返回错误且不返回任何文件内容

### Requirement: 目录列表与跳过规则

系统 SHALL 提供递归目录列表能力；列表 MUST 跳过 node_modules、target、dist、.git、.omp 目录。

#### Scenario: 列出会话 cwd
- **WHEN** 前端请求根目录列表
- **THEN** 返回相对路径、类型（file/dir）与可展开结构，且不含被跳过目录

### Requirement: 文本文件读取

系统 SHALL 仅允许读取文本文件；二进制或不可 UTF-8 解码的文件 MUST 被拒绝；单文件读取 MUST 有约 1MB 上限。

#### Scenario: 打开文本文件
- **WHEN** 用户点击一个 UTF-8 文本文件
- **THEN** 编辑器显示其内容

#### Scenario: 打开二进制或超大文件
- **WHEN** 用户点击二进制文件或超过 1MB 的文件
- **THEN** 显示错误提示，不渲染内容

### Requirement: 文件写入

系统 SHALL 提供写文件命令，目标路径 MUST 位于根路径内，且 MUST 拒绝将内容写到根之外的路径。

#### Scenario: 保存文件
- **WHEN** 用户在编辑器中修改后点击 Save 或按 Ctrl/Cmd-S
- **THEN** 文件内容写入磁盘，dirty 标记清除

#### Scenario: 越界写入
- **WHEN** 目标路径解析后位于根路径之外
- **THEN** 命令返回错误，磁盘无变化

### Requirement: 文件树交互

系统 SHALL 提供可展开/折叠目录、点击文件打开、显示相对路径的文件树，以及 Refresh 按钮。

#### Scenario: 展开与打开
- **WHEN** 用户点击目录行展开、点击文件行
- **THEN** 目录展开显示子项，文件在编辑器中打开，路径以相对根路径形式显示

### Requirement: 编辑器交互

系统 SHALL 提供等宽 textarea 编辑器，支持 Tab 缩进、dirty dot、Save 按钮与 Ctrl/Cmd-S 保存。

#### Scenario: Tab 缩进
- **WHEN** 用户在编辑器中按 Tab
- **THEN** 在光标处插入缩进而非转移焦点

#### Scenario: 未保存提示
- **WHEN** 文件有未保存修改
- **THEN** 标题旁显示 dirty dot；保存成功后消失
