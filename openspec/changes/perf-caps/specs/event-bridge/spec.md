## ADDED Requirements

### Requirement: Coalesce stream deltas
Before emitting to the webview, the host SHALL coalesce high-frequency assistant stream deltas (`text_delta` / `thinking_delta`) into batched events on a ~16ms window or after N deltas, whichever comes first.

#### Scenario: Token flood
- **WHEN** omp emits many `text_delta` frames in under 16ms
- **THEN** the webview receives fewer coalesced events whose deltas concatenate to the same text

### Requirement: Bounded stream queue
High-volume event kinds SHALL use a bounded queue. Under backpressure the host MAY drop the oldest stream events. It MUST NOT drop `ready`, `response`, `prompt_result`, or `available_commands_update`.

#### Scenario: UI behind
- **WHEN** the stream queue is full
- **THEN** older stream events may be dropped while critical kinds above are still delivered

### Requirement: Chunk reassembly bound
Pending `rpc_chunk` reassembly SHALL respect `MAX_REASSEMBLED_BYTES`. A stalled or over-cap sequence SHALL be aborted/dropped; `received` MUST NOT grow without limit.

#### Scenario: Oversize or stall
- **WHEN** a chunk sequence exceeds the cap or stalls beyond the idle timeout
- **THEN** the host aborts that pending sequence and emits a protocol error instead of growing forever

### Requirement: No unbounded Host frame log
Host MUST NOT retain an unbounded Vec of all historical frames. Any retained stderr/debug lines MUST be ring-buffered (e.g. last 64).

#### Scenario: Long stderr
- **WHEN** many stderr lines arrive over a long session
- **THEN** Host-side retained lines stay within the ring size (or are not retained at all beyond forwarding)
