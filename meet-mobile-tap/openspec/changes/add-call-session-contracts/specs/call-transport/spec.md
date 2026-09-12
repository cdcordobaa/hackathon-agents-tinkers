## Purpose

The contract every call path implements — replay, LiveKit and Twilio alike — so that the
rest of the system is written once against a normalised stream of audio and participants
instead of three times against three SDKs.

## ADDED Requirements

### Requirement: Normalised audio format
A transport SHALL emit audio as PCM16, mono, 24 kHz, regardless of the format it receives
from its underlying service. Conversion SHALL happen inside the adapter, and no
transport-native encoding SHALL be observable to consumers.

#### Scenario: A transport whose source is not 24 kHz
- **WHEN** the underlying service delivers audio at a different sample rate or encoding
- **THEN** the transport resamples and re-encodes before emitting, and consumers observe
  only PCM16 mono 24 kHz

#### Scenario: Frames are attributable
- **WHEN** any audio frame is emitted
- **THEN** it carries the speaker id it belongs to and its offset in milliseconds from
  the start of the session

### Requirement: Every frame carries a signal level
A transport SHALL compute and attach the RMS of each emitted frame. A transport SHALL NOT
report itself healthy on the basis that no error was raised.

#### Scenario: Silence is visible, not inferred
- **WHEN** a transport is receiving digitally silent audio
- **THEN** it still emits frames, each with an RMS at or near zero, so the session can
  distinguish silence from absence of data

#### Scenario: No data at all is distinguishable from silence
- **WHEN** a transport receives no packets for longer than its stall timeout
- **THEN** it reports a transport error rather than emitting synthetic silent frames

### Requirement: Declared capabilities
A transport SHALL declare, as data available before it starts, whether it can speak into
the call and whether it can end the call. Callers SHALL be able to read these without
invoking the corresponding operation.

#### Scenario: A consumer degrades instead of failing
- **WHEN** a transport declares it cannot speak into the call
- **THEN** consumers present speaking-based actions as unavailable and never invoke them

#### Scenario: A declared capability works
- **WHEN** a transport declares it can end the call
- **THEN** invoking that operation ends the call and results in an ended event

### Requirement: Participant reporting
A transport SHALL report participants joining and leaving, each with a stable id, a
display label, and a role of `subject`, `counterparty` or `unknown`.

#### Scenario: A second party joins mid-session
- **WHEN** another participant joins the call after the session is running
- **THEN** a participant event is emitted and subsequent frames from that participant
  carry the new speaker id

#### Scenario: Role is honest when it cannot be determined
- **WHEN** the underlying service does not distinguish which party is the protected user
- **THEN** the transport reports role `unknown` rather than guessing

### Requirement: Transport conformance suite
A shared conformance suite SHALL exist and every transport implementation SHALL pass it.
The suite SHALL verify audio format, frame attribution, RMS presence, capability
honesty, participant reporting, clean stop, and idempotent stop.

#### Scenario: A new adapter is judged by the same tests
- **WHEN** a new transport implementation is added
- **THEN** it is run against the shared conformance suite without transport-specific
  exemptions, and the suite fails if any contract is violated

#### Scenario: Stopping twice is safe
- **WHEN** a transport is stopped and then stopped again
- **THEN** the second stop completes without error and emits no further events

### Requirement: Replay transport
A `replay` transport SHALL exist that drives a scripted call fixture through the full
pipeline with no external service, no account, and no microphone, at a configurable
speed multiplier.

#### Scenario: The whole pipeline runs with only a model key
- **WHEN** a session is started on the replay transport
- **THEN** transcript turns and risk profiles are produced in the same shape and order as
  a live transport would produce them

#### Scenario: Replay is deterministic in its timing
- **WHEN** the same fixture is replayed twice at the same speed
- **THEN** turns are delivered at the same session-clock offsets both times
