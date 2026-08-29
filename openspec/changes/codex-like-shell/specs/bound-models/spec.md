## ADDED Requirements

### Requirement: List bound models
The shell SHALL query the running `omp` RPC session with `get_available_models` after the session is ready, and SHALL present the returned models in a selectable list (not a free-text-only field).

#### Scenario: Session ready shows models
- **WHEN** an `omp --mode rpc-ui` session emits ready and the client sends `get_available_models`
- **THEN** the UI SHALL display each returned model identity and SHALL highlight the currently active model

### Requirement: Switch bound model
The shell SHALL change the active model by sending RPC `set_model` with the provider and modelId of the selected bound model. The shell SHALL NOT require the user to type a model string to switch among already-bound models.

#### Scenario: User picks another bound model
- **WHEN** the user selects a different model from the bound-model list
- **THEN** the shell SHALL send `set_model` and SHALL update the status display to the new model on success

### Requirement: Empty override means omp default
If the user has not chosen a model, the shell SHALL omit `--model` on spawn so `omp` uses its own configured default (for example `~/.omp/agent/config.yml`).

#### Scenario: First launch with empty model
- **WHEN** settings.model is empty
- **THEN** the spawned `omp` process SHALL NOT receive a `--model` flag
