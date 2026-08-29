## ADDED Requirements

### Requirement: Horizontal model chip tabs
After `get_available_models` succeeds, the shell SHALL render bound models as a horizontal, scroll-x chip/tab row (not wrapping into a tall header). The first chip SHALL be "omp default" with empty value. The active model chip SHALL use a filled pill style (blue in light, sky in dark themes). Clicking a bound-model chip SHALL call the existing RPC `set_model` with that model's provider and id without restarting omp.

#### Scenario: Models after ready
- **WHEN** `get_available_models` returns one or more bound models
- **THEN** the UI shows a horizontal chip row including "omp default" plus one chip per model

#### Scenario: Switch via chip
- **WHEN** the user activates a non-default model chip
- **THEN** the shell sends `set_model` with that model's provider and id

#### Scenario: Many models scroll
- **WHEN** there are more chips than fit in the topbar
- **THEN** the chip row scrolls horizontally and does not wrap into multiple header rows

### Requirement: Full identity via tooltip
Each model chip MAY show a short label (e.g. `provider · id` or id alone) but MUST expose the full `provider/id` (or equivalent ref) via the element's `title` attribute. Provider grouping MAY appear as a small label above a cluster or as a prefix on the chip.

#### Scenario: Long model id
- **WHEN** a model ref is long
- **THEN** hovering/focusing the chip still reveals the full ref via title

### Requirement: Select fallback
The existing `<select id="model-select">` with provider `<optgroup>`s SHALL remain in the DOM as a hidden or overflow fallback synchronized with the chip selection. Primary UX MUST be chips/tabs.

#### Scenario: Select stays in sync
- **WHEN** the user picks a model via chip
- **THEN** the hidden select value matches that model ref (or empty for omp default)
