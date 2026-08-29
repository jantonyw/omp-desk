## Purpose

在侧栏提供内嵌浏览器视图：URL 栏 + Go 在应用内 iframe 打开 http(s) 页面，并可复用既有 open_url 命令在系统浏览器打开。

## ADDED Requirements

### Requirement: URL 输入与打开

系统 SHALL 提供 URL 输入框与 Go 按钮；仅 http/https URL 在 iframe 中打开；缺少 scheme 的输入 MUST 补全为 https://。

#### Scenario: 打开页面
- **WHEN** 用户输入 URL 并点击 Go（或按 Enter）
- **THEN** 若为 http(s) URL 则 iframe 加载该页面；否则补全 scheme 后加载

#### Scenario: 返回上一页
- **WHEN** 用户点击 Back
- **THEN** iframe 返回历史上一页（如可用）

### Requirement: 系统浏览器打开

系统 SHALL 提供「Open in system browser」按钮，复用既有 `open_url` Tauri 命令在系统浏览器打开当前 URL。

#### Scenario: 系统浏览器
- **WHEN** 用户点击「Open in system browser」
- **THEN** 调用既有 open_url 命令，系统浏览器打开当前 URL

### Requirement: iframe 被拦截时的降级

系统 SHALL 在 iframe 因 X-Frame-Options / CSP 等被阻止时显示提示，且 MUST 仍允许通过系统浏览器打开。

#### Scenario: 页面拒绝内嵌
- **WHEN** 目标站点禁止 iframe 内嵌
- **THEN** 面板显示「该站点不允许内嵌显示」提示，「Open in system browser」按钮仍可用
