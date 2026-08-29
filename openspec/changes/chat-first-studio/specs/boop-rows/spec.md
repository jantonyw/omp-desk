## ADDED Requirements

### Requirement: Sessions as list rows
The left Sessions pane SHALL present "New chat" as the primary action (maps to New session). The current session SHALL appear as a list row with a status pill (ready / streaming / stopped or equivalent), cwd as description, and model as meta — not a debug card dominated by pid.

#### Scenario: Session row
- **WHEN** a session is running and ready
- **THEN** the row shows a ready status pill, cwd text, and model meta without pid as primary content

### Requirement: Inspector Changes and Tasks as rows
Each Changes item SHALL be a row with kind/source on the left, path, and a status pill (write / edit / read). Each Tasks item SHALL be a row with step title and a todo/done status pill (checkbox toggle MAY remain). Empty states SHALL be a single quiet line, not placeholder-y filler.

#### Scenario: File change row
- **WHEN** a write/edit/read change is recorded
- **THEN** the Changes list shows a row with kind cue, path, and kind pill

#### Scenario: Empty changes
- **WHEN** there are no file changes
- **THEN** the list shows one quiet empty line

### Requirement: Plan/Execute underline tabs
Plan and Execute MUST remain available as underline tabs or a compact segmented control near the composer or top (Boop-style underline is acceptable). Behavior (prefixes, confirm execute, preamble not shown as extra YOU) MUST be preserved.

#### Scenario: Mode switch
- **WHEN** the user selects Execute
- **THEN** work mode becomes execute and subsequent non-slash sends follow existing Execute rules
