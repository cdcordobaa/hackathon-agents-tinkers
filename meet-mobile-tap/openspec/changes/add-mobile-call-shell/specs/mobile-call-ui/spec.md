## Purpose

What the protected user sees and can do on their phone before, during and immediately
after a monitored call — designed to be read at a glance by someone who is mid-conversation
and under pressure.

## ADDED Requirements

### Requirement: Consent before connection
The app SHALL obtain and record consent before any monitored call connects, SHALL state
plainly that the call will be transcribed and analysed, and SHALL offer a way to decline
that ends the session.

#### Scenario: Consent is granted
- **WHEN** the user starts a monitored call and accepts the consent notice
- **THEN** consent is recorded through the session and the call connects

#### Scenario: Consent is declined
- **WHEN** the user declines
- **THEN** no call connects, no audio is processed, and the session ends

#### Scenario: Consent cannot be skipped
- **WHEN** any path through the app reaches a connected monitored call
- **THEN** a consent record exists for that session

### Requirement: Live risk display
The app SHALL display the current risk band, score and headline, SHALL update them as new
assessments arrive, and SHALL make the current band distinguishable without reading text.

#### Scenario: Risk rises during a call
- **WHEN** successive assessments raise the risk band
- **THEN** the display updates within one assessment interval and the band change is
  perceptible without reading

#### Scenario: Risk falls on an explanation
- **WHEN** an assessment lowers the risk
- **THEN** the display lowers accordingly rather than latching at its highest value

#### Scenario: Nothing is shown before the first assessment
- **WHEN** a call has connected but no assessment has been produced
- **THEN** the app shows that analysis is starting rather than a score of zero

### Requirement: Evidence is inspectable
The app SHALL show each reported signal with the verbatim quote that supports it, so that a
claim can be checked against what was said.

#### Scenario: The user checks a claim
- **WHEN** the user opens the current signals
- **THEN** each signal shows its type, its verbatim quote, and why that quote supports it

#### Scenario: No signals, no evidence list
- **WHEN** an assessment reports no signals
- **THEN** no evidence list is shown and the screen does not imply a concern exists

### Requirement: Advice is an action
The app SHALL present the assessment's advice prominently when risk is elevated or higher,
and SHALL NOT present advice when the assessment reports none.

#### Scenario: Elevated risk surfaces advice
- **WHEN** an assessment reports elevated or high risk with advice
- **THEN** the advice is displayed prominently enough to be read without scrolling

### Requirement: Live transcript
The app SHALL display final transcript turns with speaker labels in order as they arrive.

#### Scenario: Turns appear as they finalise
- **WHEN** a turn is finalised
- **THEN** it appears in the transcript labelled with its speaker

#### Scenario: In-progress speech is not shown as final
- **WHEN** a speaker is mid-sentence
- **THEN** any in-progress text is visually distinct from finalised turns or not shown

### Requirement: Degraded states are visible
The app SHALL display when audio is silent, when transcription is degraded for a speaker,
and when the connection to the session is lost. The app SHALL NOT present a healthy
interface while any of these conditions holds.

#### Scenario: Silent audio is surfaced
- **WHEN** the session reports silent audio
- **THEN** the app shows that no audio is being received, naming the affected participant

#### Scenario: A live signal level is always visible during a call
- **WHEN** a call is connected
- **THEN** a per-participant audio level indicator is displayed

#### Scenario: Connection loss is shown and recovered
- **WHEN** the session connection drops and later recovers
- **THEN** the app shows the disconnected state, resumes from its last received event, and
  shows recovery

### Requirement: Transport selection
The app SHALL let the user choose which call path a session uses among those the gateway
offers, and SHALL display which path the current session is on.

#### Scenario: A path is chosen before starting
- **WHEN** the user selects a call path and starts a session
- **THEN** the session runs on that path and the app displays it

#### Scenario: An unavailable path is not offered
- **WHEN** the gateway reports a path as unavailable
- **THEN** the app does not offer it

### Requirement: Post-call summary
After a call ends, the app SHALL show its outcome — highest risk reached, signals found,
and any interventions taken — and SHALL offer access to the full case file.

#### Scenario: A call ends and its summary is available
- **WHEN** a session reaches its ended state
- **THEN** the app shows the summary and a way to open the case file
