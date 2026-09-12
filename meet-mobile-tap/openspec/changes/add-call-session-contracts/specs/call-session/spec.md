## Purpose

One monitored call, from the moment it is requested to the moment its case file is
sealed. Owns the session state machine, the consent gate, and the event protocol that
the mobile client and every other surface subscribe to.

## ADDED Requirements

### Requirement: Session lifecycle
A session SHALL move through exactly the states `idle`, `awaiting-consent`, `running`,
`ending`, `ended`, and SHALL NOT re-enter a state it has left. Every transition SHALL be
emitted to subscribers as a `session.state` event carrying the new state, the transport
kind, and a monotonic session clock in milliseconds.

#### Scenario: A session is created and runs to completion
- **WHEN** a client requests a session with a transport kind
- **THEN** the session is created in `idle` and a `session.state` event is emitted for
  every subsequent transition through `awaiting-consent`, `running` and `ended`

#### Scenario: A session cannot be restarted
- **WHEN** a client sends `session.start` to a session already in `ended`
- **THEN** the request is rejected with an error event and the session stays `ended`

#### Scenario: Transport failure ends the session cleanly
- **WHEN** the transport reports that the call ended, for any reason including an error
- **THEN** the session transitions to `ending`, flushes a final analysis pass, seals the
  case file, and reaches `ended` without losing turns already transcribed

### Requirement: Consent gate
A session SHALL NOT deliver any audio frame to transcription, analysis, or storage while
consent is unrecorded. Consent SHALL be recorded with a timestamp and the method by which
it was obtained, and that record SHALL be part of the session's output.

#### Scenario: Audio before consent is discarded
- **WHEN** the transport emits audio frames while the session is in `awaiting-consent`
- **THEN** the frames are counted and discarded, no transcription is started, and no
  audio is retained

#### Scenario: Consent is recorded before the first analysed turn
- **WHEN** a session produces any risk profile
- **THEN** its consent record exists and its timestamp precedes the first transcript turn

#### Scenario: Consent is refused
- **WHEN** the client declines consent
- **THEN** the session transitions directly to `ended` and the transport is stopped

### Requirement: Event protocol
The session SHALL publish a versioned, append-only stream of events to every subscriber:
`session.state`, `transcript.turn`, `risk.updated`, `audio.silent`, `signal.caller`,
`intervention.proposed`, `intervention.executed`, and `case.ready`. Every event SHALL
carry the session id, a sequence number that increases by one, and the session clock.

#### Scenario: A late subscriber is not left blind
- **WHEN** a client subscribes to a session already in `running`
- **THEN** it immediately receives the current state, the latest risk profile if one
  exists, and the sequence number it is resuming from

#### Scenario: Dropped connection does not lose ordering
- **WHEN** a client reconnects and supplies the last sequence number it saw
- **THEN** it receives every event after that number in order, or an explicit signal that
  the backlog is no longer available

#### Scenario: Unknown event types do not break clients
- **WHEN** the server emits an event type a client does not recognise
- **THEN** the client ignores it and continues processing subsequent events

### Requirement: Silence detection
The session SHALL monitor the RMS of incoming audio frames and SHALL emit `audio.silent`
when frames remain below the silence threshold for longer than the configured window,
and SHALL emit a corresponding recovery event when non-silent audio resumes.

#### Scenario: A transport that delivers only zeros is reported
- **WHEN** a transport emits frames whose RMS is below threshold for the whole window
- **THEN** the session emits `audio.silent` naming the affected speaker

#### Scenario: A working transport is never reported as silent
- **WHEN** a transport emits frames with speech-level RMS
- **THEN** no `audio.silent` event is emitted for that speaker

### Requirement: Session registry
The gateway SHALL address sessions by opaque id, SHALL support more than one concurrent
session, and SHALL release all transport, transcription and analysis resources when a
session reaches `ended`.

#### Scenario: Two sessions do not cross-talk
- **WHEN** two sessions run concurrently
- **THEN** each subscriber receives only events for the session it subscribed to

#### Scenario: Resources are released
- **WHEN** a session reaches `ended`
- **THEN** its transport is stopped, its analysis timer is cleared, and its entry is
  removed from the registry
