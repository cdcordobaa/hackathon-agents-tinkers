## Purpose

The durable record of a monitored call — what was said, what was assessed, what was decided
and what was done — assembled so a person can act on it afterwards, and governed by an
explicit decision about what is kept and for how long.

## ADDED Requirements

### Requirement: Assembled from the session event stream
The case file SHALL be derived from the session's published events and SHALL NOT depend on
a separate record. Anything not published as an event SHALL NOT appear in the case file.

#### Scenario: The case file matches the session
- **WHEN** a session ends
- **THEN** its case file contains exactly the turns, assessments, signals, caller
  information and interventions that were published during the session

#### Scenario: A partial session still produces a case file
- **WHEN** a session ends early, including by error
- **THEN** a case file is produced from the events that were published, marked as
  incomplete with the reason

### Requirement: Risk timeline
The case file SHALL record every assessment produced during the call in order, each with
its band, score, headline and what changed, so the progression of risk is visible and not
only its final value.

#### Scenario: The trajectory is inspectable
- **WHEN** a case file is opened for a call whose risk rose over time
- **THEN** each assessment appears in order with its band, score and change summary

#### Scenario: A lowered score is preserved
- **WHEN** an assessment lowered the risk during the call
- **THEN** that assessment and its stated reason appear in the timeline

### Requirement: Evidence is preserved with attribution
Every signal in the case file SHALL retain its verbatim quote, the speaker it is attributed
to, and its time offset in the call.

#### Scenario: A claim can be traced to what was said
- **WHEN** a signal is reviewed in the case file
- **THEN** its quote, speaker and offset are present and the quote appears in the
  transcript at that offset

### Requirement: Consent, caller information and interventions are recorded
The case file SHALL include the consent record, the caller reputation result including its
unknown or unavailable states, and every intervention proposed during the call with its
decision and outcome.

#### Scenario: Consent is provable
- **WHEN** a case file is reviewed
- **THEN** it shows when consent was recorded and by what method, and that it preceded the
  first transcript turn

#### Scenario: Declined interventions are not omitted
- **WHEN** an intervention was proposed and declined or expired
- **THEN** it appears in the case file with that outcome

#### Scenario: Unknown caller information stays unknown
- **WHEN** caller reputation could not be determined
- **THEN** the case file records it as unknown and does not present it as clean

### Requirement: Export
The case file SHALL be exportable both as a structured machine-readable document and as a
readable summary suitable for sending to a bank or another person.

#### Scenario: A structured export is complete
- **WHEN** a case file is exported in structured form
- **THEN** it contains the timeline, transcript, signals with quotes, consent, caller
  information and intervention audit

#### Scenario: A readable summary stands alone
- **WHEN** a case file is exported as a summary
- **THEN** it states what happened, the highest risk reached, the key evidence with quotes,
  and what was done, without requiring the structured export to be understood

### Requirement: Retention and deletion
The system SHALL apply an explicit retention period to case files, SHALL make that period
visible to the user, and SHALL support deletion that removes the case file and its
transcript.

#### Scenario: The user deletes a case file
- **WHEN** the user deletes a case file
- **THEN** its transcript, assessments and evidence are removed and it is no longer
  retrievable

#### Scenario: Retention is stated, not implied
- **WHEN** a case file is created
- **THEN** its retention period is recorded and visible to the user

### Requirement: Audio is not retained
The system SHALL NOT persist call audio as part of the case file by default.

#### Scenario: No recording is kept
- **WHEN** a call completes and its case file is written
- **THEN** no call audio is stored, and the transcript is the retained evidence
