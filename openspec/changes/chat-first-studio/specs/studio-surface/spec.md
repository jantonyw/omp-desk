## ADDED Requirements

### Requirement: Light-first surfaces with shared layout
Light theme MUST use white surfaces, soft gray borders, generous padding, and 12–16px radius on composer and cards, without debug-console density. Dark and Midnight MUST use the same layout structure (model chips, empty state, Boop rows), not Light-only chrome. All four themes (dark / midnight / light / system) MUST remain selectable via the existing theme picker. Settings MUST remain available.

#### Scenario: Light chrome
- **WHEN** theme is Light
- **THEN** surfaces read as white/soft-gray with rounded composer well and soft borders

#### Scenario: Dark same layout
- **WHEN** theme is Dark or Midnight
- **THEN** model chips, empty-state composer, and list rows are present with the same structure as Light

### Requirement: Quiet status and full-bleed app
`#app` MUST fill the window. The status bar MUST be a quieter single line; pid MAY live in a tooltip rather than primary status text. Message count and mode MAY remain. Full model id MUST remain discoverable (status and/or title).

#### Scenario: Status line
- **WHEN** a session has a pid and long model id
- **THEN** the visible status line stays one quiet row and pid is available via tooltip if omitted from primary text
