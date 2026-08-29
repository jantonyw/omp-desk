## ADDED Requirements

### Requirement: WebKit/WebView GPU compositing
The shell SHALL prefer hardware-accelerated compositing for the embedded webview. GPU work here is WebKit/WebView2 compositing only — not a custom wgpu/Vulkan scene or alternate UI toolkit.

#### Scenario: Linux policy
- **WHEN** the app starts on Linux
- **THEN** the host opts into WebKit hardware acceleration (e.g. `hardware-acceleration-policy` Always) and does not set env vars that force software compositing (`WEBKIT_DISABLE_COMPOSITING_MODE` unset / not forced on)

#### Scenario: Windows browser args
- **WHEN** the app runs on Windows WebView2
- **THEN** window config includes additional browser args that enable GPU (and do not pass `--disable-gpu`)

#### Scenario: Document intent
- **WHEN** a maintainer reads the GPU setup code
- **THEN** a short comment states that GPU means WebKit compositing, not a wgpu scene
