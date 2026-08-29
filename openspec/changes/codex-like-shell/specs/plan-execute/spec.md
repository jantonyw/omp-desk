## ADDED Requirements

### Requirement: Plan before execute
The shell SHALL offer an explicit Plan mode that asks `omp` to produce a plan without applying code changes, and an Execute mode that carries out an approved plan.

#### Scenario: User starts in Plan
- **WHEN** the user sends a task while Plan mode is active
- **THEN** the assistant turn SHALL be treated as planning (no file-mutating execution expected from the shell's mode flag / plan invocation)
- **AND** the plan content SHALL remain visible in the transcript

#### Scenario: User confirms Execute
- **WHEN** the user confirms Execute after a plan exists
- **THEN** the shell SHALL send a follow-up that instructs `omp` to implement the plan (using omp plan-yolo / abort_and_prompt / prompt as designed)
- **AND** subsequent tool-execution events SHALL appear in the transcript and the changes panel

### Requirement: Task breakdown
The shell SHALL parse or receive a structured task list from the plan when possible, and SHALL render those tasks as a checklist in the execution panel.

#### Scenario: Plan contains steps
- **WHEN** a plan with multiple steps is shown
- **THEN** the UI SHALL list those steps separately from the chat bubbles so the user can track execution

### Requirement: Core stays omp
The shell SHALL NOT reimplement the agent loop, tools, or providers. Planning and execution SHALL be driven by the existing `omp` child via rpc-ui.

#### Scenario: No second agent
- **WHEN** Plan or Execute runs
- **THEN** only the spawned `omp` process SHALL call models and tools
