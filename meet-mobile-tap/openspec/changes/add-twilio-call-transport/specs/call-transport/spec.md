## ADDED Requirements

### Requirement: PSTN media-stream transport
A Twilio transport SHALL answer or place a call, fork its audio to the gateway as a live
media stream, and emit normalised frames for the duration of the call. Audio SHALL be
obtained server-side and SHALL NOT require the device to deliver samples.

#### Scenario: A live call reaches the pipeline
- **WHEN** a call is connected on the Twilio transport
- **THEN** the transport emits frames continuously while either party is speaking, and the
  session produces transcript turns from them

#### Scenario: The call ends from the far end
- **WHEN** the remote party hangs up
- **THEN** the transport reports the call ended and the session flushes and seals normally

#### Scenario: The media stream stops without the call ending
- **WHEN** no media packets arrive for longer than the stall timeout while the call is up
- **THEN** the transport reports a transport error rather than emitting silent frames

### Requirement: Narrowband conversion inside the adapter
The transport SHALL decode the carrier's narrowband encoding and resample to PCM16 mono
24 kHz before emitting. No consumer SHALL be exposed to the carrier's sample rate or
encoding, and no consumer SHALL require configuration to handle this transport.

#### Scenario: Consumers see one format
- **WHEN** audio arrives from the carrier at 8 kHz
- **THEN** emitted frames are PCM16 mono 24 kHz and pass the conformance suite's format
  assertion unchanged

#### Scenario: Conversion quality is measured, not assumed
- **WHEN** the narrowband path is evaluated against the wideband path on the same speech
- **THEN** a transcription word error rate is recorded for both, and the difference is
  documented

### Requirement: Leg direction determines speaker role
The transport SHALL request separate tracks per call leg and SHALL assign role `subject`
to the protected user's leg and `counterparty` to the far end. The transport SHALL NOT
emit both parties under a single speaker id.

#### Scenario: Two legs, two speakers
- **WHEN** both parties speak during a call
- **THEN** their audio is emitted under distinct speaker ids with correct roles

#### Scenario: A mixed stream is refused
- **WHEN** the carrier delivers a single mixed track instead of separate legs
- **THEN** the transport reports an error rather than attributing both parties to one
  speaker

### Requirement: PSTN transport capabilities
The Twilio transport SHALL declare `canSpeak` true and `canHangup` true, SHALL be able to
play audio into a call in progress, and SHALL be able to end the call.

#### Scenario: A warning is played into a live call
- **WHEN** an intervention asks the transport to speak a warning
- **THEN** the audio is played into the connected call and both parties can hear it

#### Scenario: The call is ended on request
- **WHEN** an intervention asks the transport to end the call
- **THEN** the call is terminated and an ended event follows

#### Scenario: Call control after the call ended is inert
- **WHEN** speak or hang up is invoked after the call has already ended
- **THEN** the operation completes without error and changes nothing

### Requirement: No account-state audio precedes the conversation
The transport SHALL NOT be used for a demonstration or production call on an account
configuration that injects carrier or vendor announcements before the parties connect.

#### Scenario: The call opens on the conversation
- **WHEN** a call is placed or received for a demonstration
- **THEN** the first audio either party hears is the other party, with no account-status
  announcement
