## Purpose

Turns attributed call audio into speaker-labelled final turns that the analyzer can reason
about, and reports honestly when it is not working — a stalled transcriber and a silent
room produce the same empty transcript.

## ADDED Requirements

### Requirement: Streaming transcription per speaker
The system SHALL maintain one streaming transcription session per speaker and SHALL feed
it only that speaker's frames. Speaker attribution SHALL come from the transport, and the
system SHALL NOT perform speaker separation on mixed audio.

#### Scenario: Two speakers produce two labelled streams
- **WHEN** a call has two speakers emitting audio concurrently
- **THEN** turns are produced labelled with the correct speaker without any diarization step

#### Scenario: A speaker joining mid-call gets a session
- **WHEN** a new speaker is reported by the transport after the session is running
- **THEN** a transcription session is opened for them and their turns are labelled correctly

#### Scenario: Sessions are closed with the call
- **WHEN** the session ends
- **THEN** every transcription connection is closed and none is left open

### Requirement: Only finals enter the transcript
The system SHALL distinguish in-progress results from final results. Only finals SHALL be
appended to the rolling transcript. An in-progress result SHALL replace the previous
in-progress result for that speaker, never append to it.

#### Scenario: A revised partial does not duplicate text
- **WHEN** a speaker's in-progress text is revised several times before the turn closes
- **THEN** the transcript contains the final text exactly once and no partial fragments

#### Scenario: Analysis never sees unstable text
- **WHEN** an analysis pass runs while a speaker is mid-sentence
- **THEN** the rendered transcript contains no in-progress text for that speaker

#### Scenario: An empty final is discarded
- **WHEN** a final result contains only whitespace
- **THEN** nothing is appended to the transcript

### Requirement: Transcription failure is visible
The system SHALL detect a transcription connection that has dropped or stalled, SHALL
attempt reconnection with backoff, and SHALL emit an explicit degraded state naming the
affected speaker. The system SHALL NOT allow a failed transcriber to be indistinguishable
from a quiet speaker.

#### Scenario: A dropped connection is reported and recovered
- **WHEN** a transcription connection drops mid-call
- **THEN** a degraded state naming that speaker is emitted, reconnection is attempted, and
  a recovery state is emitted once turns resume

#### Scenario: Audio arriving with no turns produced is reported
- **WHEN** a speaker's frames are above the silence threshold for longer than the stall
  window but no final has been produced
- **THEN** a degraded state is emitted for that speaker

#### Scenario: A quiet speaker is not reported as failed
- **WHEN** a speaker is present but silent
- **THEN** no degraded state is emitted for them

### Requirement: Turn events
Every final turn SHALL be published on the session event stream with its speaker, text,
and offset in milliseconds from the start of the session.

#### Scenario: The client can render the conversation live
- **WHEN** a turn is finalised
- **THEN** a `transcript.turn` event carrying speaker, text and offset is delivered to
  subscribers before the next analysis pass that includes it

### Requirement: Transcription latency budget
The system SHALL record the interval between the end of speech and the availability of the
corresponding final turn, and that measurement SHALL be reportable for a session.

#### Scenario: Latency is measured, not assumed
- **WHEN** a session completes
- **THEN** per-turn transcription latency is available for the whole session

### Requirement: Transcribed speech is data
Transcribed text SHALL be treated as data at every downstream boundary and SHALL NOT be
interpreted as instructions to the system.

#### Scenario: A speaker issues an instruction to the system
- **WHEN** a speaker says something shaped as a command to the assistant or the analyzer
- **THEN** it is recorded as a turn like any other and no system behaviour changes as a
  result of its content
