## ADDED Requirements

### Requirement: WebRTC room transport
A LiveKit transport SHALL join the room as a participant and subscribe to the audio
tracks of every other participant, emitting normalised frames per participant. Audio
SHALL be obtained server-side; the mobile client SHALL NOT be required to deliver samples.

#### Scenario: Two participants in a room produce two audio streams
- **WHEN** a phone and a second client are both publishing microphone tracks
- **THEN** the transport emits frames attributed to two distinct speaker ids

#### Scenario: Speaker separation needs no diarization
- **WHEN** both participants talk over each other
- **THEN** each participant's audio is emitted under its own speaker id without any
  speaker-separation step

#### Scenario: A participant who joins late is picked up
- **WHEN** a third participant joins and publishes audio after the session is running
- **THEN** the transport subscribes to the new track and emits its frames

### Requirement: Token issuance by the gateway
Room access tokens SHALL be minted by the gateway per session and delivered to the client
on request. API secrets SHALL NOT be present on the device, and a token SHALL NOT outlive
its session.

#### Scenario: The client obtains a token at join time
- **WHEN** a client starts a session on the LiveKit transport
- **THEN** the gateway returns a token scoped to that session's room and identity

#### Scenario: No long-lived credential is bundled
- **WHEN** the mobile app is built
- **THEN** no LiveKit API secret and no pre-minted long-lived token is present in the bundle

#### Scenario: A token for an ended session is refused
- **WHEN** a token is requested for a session that has ended
- **THEN** the request is rejected and no token is issued

### Requirement: Role assignment from room identity
The transport SHALL map the participant identity the gateway issued to the protected user
onto role `subject`, and every other participant onto role `counterparty`.

#### Scenario: The phone is the subject
- **WHEN** the session's own issued identity publishes audio
- **THEN** its frames carry role `subject`

#### Scenario: An unrecognised participant is a counterparty
- **WHEN** a participant the gateway did not issue an identity for joins
- **THEN** its frames carry role `counterparty`

### Requirement: WebRTC transport capabilities
The LiveKit transport SHALL declare `canSpeak` true and `canHangup` false, and speaking
SHALL be implemented by publishing an audio track into the room.

#### Scenario: A warning can be spoken into the room
- **WHEN** an intervention asks the transport to speak
- **THEN** audio is published into the room and heard by the other participants

#### Scenario: Ending is not claimed
- **WHEN** an intervention asks whether the call can be ended
- **THEN** the transport reports the capability as unavailable
