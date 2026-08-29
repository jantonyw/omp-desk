## ADDED Requirements

### Requirement: Centered empty-state composer
When the transcript has no user or assistant messages, the chat pane SHALL hide the log-dump feel and center a short welcome ("Ask omp") plus a wide rounded composer well in the chat pane (not a tiny footer-only strip). The composer placeholder SHALL be "Ask me anything" (slash hint MAY remain). System/tool-only noise MUST NOT count as starting a conversation for empty-state purposes.

#### Scenario: Fresh session
- **WHEN** a session is ready and no user/assistant messages exist
- **THEN** the welcome and centered composer are visible

#### Scenario: After first message
- **WHEN** the user sends the first user message (or an assistant message appears)
- **THEN** the welcome hides and the composer docks to the bottom as a rounded well

### Requirement: Composer chrome without fake tools
The composer well SHALL include a left control that focuses the composer and inserts `/` to open the existing slash palette, and a right circular filled Send control. Abort SHALL appear as a ghost control when streaming. The UI MUST NOT add fake web-search, image, or tool buttons that have no RPC backing.

#### Scenario: Slash trigger
- **WHEN** the user clicks the left `/` (or `+`) control
- **THEN** the composer focuses with `/` inserted and the existing slash palette can open

#### Scenario: Send circle
- **WHEN** the session is ready and the user clicks Send
- **THEN** the existing send path runs (Plan/Execute prefixes and slash handling unchanged)
