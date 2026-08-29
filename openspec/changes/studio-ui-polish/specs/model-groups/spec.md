## ADDED Requirements

### Requirement: Provider-grouped model picker
The model select SHALL group bound models by `provider` using HTML `<optgroup label="{provider}">`. An empty-value option labeled "omp default" SHALL remain first. Selecting a bound model SHALL call the real RPC `set_model` without restarting the omp process.

#### Scenario: Models listed after ready
- **WHEN** `get_available_models` returns models from multiple providers
- **THEN** the select SHALL render one optgroup per provider containing those models

#### Scenario: Switch model
- **WHEN** the user picks a non-empty model option
- **THEN** the shell SHALL send `set_model` with that model's provider and id

### Requirement: Full model identity visible
The status bar and header model control SHALL show the full current model id (e.g. `deepseek/deepseek-v4-pro`), never a truncated display name. CSS SHALL NOT ellipsis-clip the model identity; the select SHALL be wide enough to read the id.

#### Scenario: Long model id
- **WHEN** the active model id is a long `provider/id` string
- **THEN** the status bar and select SHALL still expose the full id without mid-string ellipsis clipping of that identity

### Requirement: Optional role annotation
IF role information (default / smol / slow / plan) is present on model responses, the option label MAY annotate that role. IF absent, provider groups alone are sufficient.

#### Scenario: No role fields
- **WHEN** model objects lack role metadata
- **THEN** the picker SHALL still group by provider without failing
