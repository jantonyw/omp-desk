## ADDED Requirements

### Requirement: Article-readable chat
Assistant messages MUST read as articles (14px body, ~1.55 line-height, markdown h1–h3, lists, fenced code with token background, inline code). User messages MUST appear as distinct bubbles/cards, not log lines. Role labels MUST NOT use shouty ALL-CAPS alone; prefer a small avatar/dot plus sentence-case name.

#### Scenario: Assistant markdown
- **WHEN** an assistant message contains markdown headings, lists, and fenced code
- **THEN** they render with studio typography tokens (not terminal dump density)

#### Scenario: User bubble
- **WHEN** the user sends a message
- **THEN** it appears in a distinct card-like bubble with sentence-case role labeling

### Requirement: Docked composer
The composer MUST be a Cursor-like dock: rounded 10–12px input well spanning the chat pane, Send as a compact primary pill inside or beside the well, Abort as ghost. Slash palette MUST continue to overlay above the well.

#### Scenario: Slash still works
- **WHEN** the user types `/`
- **THEN** the filterable palette appears above the composer well without breaking send/abort

### Requirement: Studio panes and chrome
Sessions | Chat | Inspector MUST use 1px token borders and ~8px radius/density. Pane titles MAY stay small but MUST use Title Case. Session card MUST look like a list row (status pill, cwd truncated with title tooltip, model). Topbar MUST include brand, Plan/Execute segmented control, full model select with optgroups (no ellipsis clip of model id), Theme, and Settings.

#### Scenario: Full-width app
- **WHEN** the window is wider than 1200px
- **THEN** `#app` fills the window without centered max-width gutters

#### Scenario: Status bar
- **WHEN** a long `provider/id` model is active
- **THEN** the status bar shows a single line and does not ellipsis-clip the model id

### Requirement: Interaction affordances
Buttons MUST use `cursor: pointer`, visible focus rings, and hover states. UI font Inter/system-ui; code ui-monospace. No emoji-as-icons. Plan/Execute, grouped models, markdown, and Plan preamble hiding MUST keep working.

#### Scenario: Focus ring
- **WHEN** the user keyboard-focuses Send or Theme select
- **THEN** a visible focus ring using accent tokens appears
