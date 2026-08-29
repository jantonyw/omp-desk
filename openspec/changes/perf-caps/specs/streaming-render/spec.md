## ADDED Requirements

### Requirement: Incremental stream paint
While an assistant turn is streaming, the shell SHALL update only the live assistant bubble text (plain text via textContent or equivalent single-node update). It MUST NOT rebuild the entire `#transcript` via `innerHTML` on every `text_delta`, and MUST NOT run `marked` + DOMPurify on every delta.

#### Scenario: Token stream
- **WHEN** many `text_delta` events arrive for the live assistant message
- **THEN** the UI updates that bubble's text without regenerating other transcript nodes

#### Scenario: Turn complete markdown
- **WHEN** the assistant turn ends (streaming flag clears / message finalized)
- **THEN** the shell renders that bubble's markdown once with sanitize

### Requirement: rAF coalesce
UI paints driven by stream updates SHALL be coalesced with `requestAnimationFrame` so multiple deltas in one frame result in at most one DOM write.

#### Scenario: Burst deltas
- **WHEN** several stream notifications occur before the next animation frame
- **THEN** only one paint runs for that frame

### Requirement: Preserve studio chrome behavior
Slash palette, themes, model chips, and Plan/Execute flows SHALL keep working with the same RPC and user-visible behavior as before this change.

#### Scenario: Slash still works
- **WHEN** the user types `/` in the composer
- **THEN** the slash palette still filters and inserts commands as before
