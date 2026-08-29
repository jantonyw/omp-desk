## ADDED Requirements

### Requirement: Three-pane studio layout
The window SHALL present three primary panes: a left session/project list, a center conversation (transcript + composer), and a right inspector for files/changes and run/plan tasks. Layout SHALL remain usable at 1280×800 without hiding the composer.

#### Scenario: Default window shows composer
- **WHEN** the app opens at 1280×800
- **THEN** the composer and send control SHALL be visible without requiring maximize

### Requirement: Changes inspector
The right pane SHALL include a Changes view populated from `omp` tool-execution events (read/write/edit paths), analogous to a "Files Changed" list.

#### Scenario: Edit tool runs
- **WHEN** `omp` emits a tool execution that writes or edits a file
- **THEN** that path SHALL appear in the Changes list

### Requirement: Run workspace control
The right pane SHALL expose a control to start/stop the current workspace session (new session / abort), clearly labeled, without requiring the settings drawer.

#### Scenario: Start from inspector
- **WHEN** the user clicks the run/new-session control
- **THEN** a live `omp` rpc-ui child SHALL start (or replace the previous child) as today
