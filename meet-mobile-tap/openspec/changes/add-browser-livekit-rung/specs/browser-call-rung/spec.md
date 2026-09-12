## Purpose

Makes the LiveKit rung demo-complete without Twilio in the loop: a browser page joins a
LiveKit room as a participant, transcribes every other participant's track locally using
the starter kit's listening Realtime session, and delivers the resulting speaker-labelled
segments to the call session as an authorised `TranscriptSource`. Without this, LiveKit
is a call path with no transcript producer, and the risk HUD it feeds stays dead — a
fallback that cannot show the product's actual output is not a usable fallback.

## ADDED Requirements

### Requirement: Browser joins a LiveKit room and transcribes per participant

The browser app SHALL join a LiveKit room as a participant and SHALL open one
transcription session per remote participant's audio track. Speaker attribution SHALL
come from the LiveKit track a segment was transcribed from, and the system SHALL NOT
perform diarization on mixed audio.

#### Scenario: Two participants produce two labelled transcript streams

- **WHEN** two participants are in the room and both are speaking
- **THEN** segments are produced labelled with the correct participant's speaker id
  without any diarization step

#### Scenario: A participant who joins late is picked up

- **WHEN** a third participant joins the room and publishes audio after the browser app
  is already running
- **THEN** a transcription session is opened for their track and their segments carry
  their speaker id

#### Scenario: Leaving the room closes its transcription session

- **WHEN** a participant leaves the room or the browser page is closed
- **THEN** the transcription session for that participant's track is closed and no
  further segments are produced for it

### Requirement: Segments delivered match the shared TranscriptSource contract

Every segment the browser app produces SHALL be shaped as a `TranscriptSegment`
(`shared/src/transcript-source.ts`): it SHALL carry `speakerId`, `role`, `text`,
`isFinal`, `sequence`, `providerEventKey`, and `atMs`. A segment for which role cannot be
determined SHALL carry role `unknown` rather than a guessed role.

#### Scenario: A finalized turn is a well-formed segment

- **WHEN** a transcription session reports a completed turn for a participant
- **THEN** a `TranscriptSegment` is produced with `isFinal: true`, non-empty `text`, a
  monotonically assigned `sequence` for that speaker, and a `providerEventKey` unique to
  that turn

#### Scenario: Role is not guessed when it cannot be known

- **WHEN** the browser app cannot determine whether a participant is the protected user
  or the counterparty
- **THEN** the segment's `role` is `unknown`

### Requirement: Segment ingestion is bound to an authorised session

The gateway's browser-segment ingest route SHALL accept a segment only when the request
carries a credential that authorises the caller for the specific session id the segment
names. The system SHALL NOT accept a segment for a session the caller is not authorised
for, and SHALL NOT treat a syntactically valid session id alone as sufficient
authorization.

#### Scenario: An authorised browser session can post segments

- **WHEN** a browser app holds the session credential the gateway issued for session S
  and POSTs a segment naming session S
- **THEN** the segment is accepted and routed into session S's transcript

#### Scenario: A segment for a session the caller does not own is refused

- **WHEN** a POST names a session id the caller's credential does not authorise
- **THEN** the segment is refused, nothing is written into that session's transcript, and
  the response makes clear the write did not happen

#### Scenario: A segment with no credential is refused

- **WHEN** a POST carries no session credential at all
- **THEN** the segment is refused before any session lookup treats the session id as
  trustworthy

### Requirement: Browser transcription failure is visible, not silent

The system SHALL detect a browser transcription session that has failed to connect,
dropped, or stopped producing turns, and SHALL emit an explicit degraded state naming the
affected speaker, matching the degraded-state contract `add-live-transcription` defines
for other transports.

#### Scenario: A dropped browser transcription session is reported

- **WHEN** a participant's transcription WebSocket in the browser closes unexpectedly
  mid-call
- **THEN** a degraded state naming that speaker is emitted to the session

#### Scenario: A quiet participant is not reported as failed

- **WHEN** a participant is present in the room but not speaking
- **THEN** no degraded state is emitted for them

### Requirement: No long-lived transcription credential reaches the browser

The browser app SHALL obtain a short-lived, transcription-scoped credential from the
gateway per session rather than embedding a provider API key, mirroring the no-long-lived-
credential rule already applied to LiveKit room tokens.

#### Scenario: The browser app is built with no embedded API key

- **WHEN** the browser app's bundle is inspected
- **THEN** no OpenAI API key and no long-lived Realtime credential is present in it

#### Scenario: The credential cannot generate a spoken reply

- **WHEN** the browser app's transcription-scoped credential is used to open a Realtime
  session
- **THEN** the session is transcription-only and produces no spoken or generated response
  under any input
