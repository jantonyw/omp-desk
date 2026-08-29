## ADDED Requirements

### Requirement: Fetch available slash commands
After the omp session is ready, the shell SHALL send the real RPC `get_available_commands` and cache the returned commands. The shell SHALL also apply unsolicited stdout frames of type `available_commands_update`.

#### Scenario: Ready loads commands
- **WHEN** a `ready` frame is received
- **THEN** the shell SHALL request `get_available_commands` and store `commands`

#### Scenario: Push update
- **WHEN** omp emits `available_commands_update`
- **THEN** the shell SHALL replace its cached command list with the frame's `commands`

### Requirement: Filterable slash palette
When composer text starts with `/`, the UI SHALL show a filterable palette of cached slash commands (name, aliases, description). ArrowUp / ArrowDown SHALL move the highlight; Enter SHALL insert the selected command as `/name` (plus a trailing space when an input hint exists).

#### Scenario: Type slash
- **WHEN** the user types `/` as the first character
- **THEN** a palette of matching commands SHALL appear above or over the composer

#### Scenario: Insert command
- **WHEN** the user confirms a palette entry with Enter
- **THEN** the composer SHALL contain `/name` (and a space if a hint is present) without yet sending

### Requirement: Dispatch as prompt
Sending a slash line SHALL use the existing `prompt` / `abort_and_prompt` path. The shell MUST NOT invent a slash-command RPC. Lines starting with `/` SHALL skip Plan-mode prefix injection and be sent as the user typed them.

#### Scenario: Send slash in Plan mode
- **WHEN** work mode is Plan and the composer text starts with `/`
- **THEN** the shell SHALL send the typed slash line via prompt without prepending the Plan instruction prefix
