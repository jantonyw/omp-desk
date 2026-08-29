## ADDED Requirements

### Requirement: Transcript entry cap
The client transcript store SHALL not grow without bound. It MUST keep at most about 200 user/assistant/tool messages, dropping the oldest when over the cap.

#### Scenario: Long session
- **WHEN** more than 200 user/assistant/tool entries would be stored
- **THEN** the oldest such entries are dropped so the count stays within the cap

### Requirement: Changed-files cap
The changed-files list SHALL be capped (about 100 entries), dropping the oldest when over the cap.

#### Scenario: Many tool file touches
- **WHEN** more than 100 distinct changed-file records would be stored
- **THEN** the oldest records are dropped
