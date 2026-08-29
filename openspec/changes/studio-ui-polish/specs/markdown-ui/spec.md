## ADDED Requirements

### Requirement: Assistant markdown rendering
Assistant transcript bodies SHALL render Markdown for headings, lists, fenced code, bold/italic, and links, using `marked` and a sanitizer allowlist (e.g. p/h1–h3/ul/ol/li/pre/code/a/strong/em/blockquote/br/hr). User bubbles SHALL remain escaped plain text.

#### Scenario: Fenced code in assistant reply
- **WHEN** an assistant message contains a fenced code block
- **THEN** the UI SHALL render it as sanitized HTML `<pre><code>` rather than raw backticks

### Requirement: Strip emphasis in tasks
Plan task labels SHALL strip Markdown emphasis markers so users do not see raw `**bold**` in the Tasks list.

#### Scenario: Bold step text
- **WHEN** a parsed plan step contains `**text**`
- **THEN** the Tasks list SHALL display `text` without the asterisks

### Requirement: Hide Plan preamble echo
Optimistic `appendUser` shows the typed text. When omp echoes the injected Plan/Execute payload, the shell SHALL NOT create a second YOU bubble. Comparison or skip logic SHALL account for `PLAN_PREFIX` / `EXECUTE_PREFIX`.

#### Scenario: One Enter in Plan mode
- **WHEN** the user sends one Plan-mode message
- **THEN** the transcript SHALL show exactly one YOU bubble containing only the typed text

### Requirement: Dense studio fit
The three-pane layout (Sessions | Chat | Inspector) SHALL fit approximately 1200×760 / 1280×800 without clipping the composer, Inspector, or status bar. Window width SHALL stay ≤1200 by default. UI density SHALL use dark zinc styling (~13px UI / 14px chat).

#### Scenario: Default window
- **WHEN** the app opens at the configured default size
- **THEN** composer, Inspector, and status bar SHALL all be visible without horizontal clipping of the Inspector

### Requirement: Message count updates
The status bar message counter SHALL update from `get_state` `messageCount`, increment on user send, and refresh on relevant session state events so it does not remain stuck at `0 msgs`.

#### Scenario: After user send
- **WHEN** the user successfully sends a prompt
- **THEN** the status bar msg count SHALL increase from its previous value
