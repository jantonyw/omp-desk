## ADDED Requirements

### Requirement: Multi-theme selection
The desktop shell MUST support themes `dark`, `midnight`, `light`, and `system`, selectable from chrome without restart.

#### Scenario: User picks Light
- **WHEN** the user selects Light in the Theme control
- **THEN** the UI restyles immediately using light tokens and `color-scheme: light`

#### Scenario: User picks Midnight
- **WHEN** the user selects Midnight
- **THEN** near-black Codex tokens apply and `color-scheme: dark`

#### Scenario: User picks System with OS dark
- **WHEN** theme is `system` and `prefers-color-scheme: dark`
- **THEN** dark tokens apply

#### Scenario: User picks System with OS light
- **WHEN** theme is `system` and `prefers-color-scheme: light`
- **THEN** light tokens apply

### Requirement: Persist theme choice
The chosen theme MUST be stored in `localStorage` under key `omp-desk.theme` and restored on load.

#### Scenario: Reload restores theme
- **WHEN** the user previously selected `midnight` and reloads
- **THEN** `data-theme="midnight"` is applied (before first paint when possible)

#### Scenario: Missing or invalid value
- **WHEN** the key is missing or not one of the four values
- **THEN** the shell defaults to `dark`

### Requirement: CSS-variable-only colors
All theme colors MUST be expressed via CSS custom properties on `:root` / `[data-theme="..."]` (and system media queries). Hard-coded dark-only hexes MUST NOT remain for surfaces that need to flip in light theme.

#### Scenario: Light theme surfaces
- **WHEN** theme is `light`
- **THEN** borders, composer, slash palette, code blocks, and status bar remain readable with ≥4.5:1 text contrast

### Requirement: Topbar Theme control
The topbar MUST expose a compact Theme control (select or segmented) next to Settings with options Dark / Midnight / Light / System.

#### Scenario: Control visible
- **WHEN** the app chrome is shown
- **THEN** Theme control is adjacent to Settings and changing it updates the theme immediately
