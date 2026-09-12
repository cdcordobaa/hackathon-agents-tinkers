## Purpose

Running the whole system in front of an audience without depending on every part of it
working — a visible ladder of call paths, a pre-flight check over every external dependency,
and a rehearsed script with a known detection point.

## ADDED Requirements

### Requirement: Transport fallback ladder
The system SHALL offer its call paths as an ordered ladder, SHALL allow switching between
them without restarting the application, and SHALL make the path in use visible at all
times. Each path SHALL deliver the complete pipeline on its own.

#### Scenario: A path is unavailable and the next is used
- **WHEN** the preferred call path cannot be used
- **THEN** the next path on the ladder can be selected and produces transcript turns and
  risk assessments as normal

#### Scenario: The bottom rung needs nothing external
- **WHEN** every external service is unavailable
- **THEN** the scripted path still runs a complete session with transcript, assessments and
  a case file

#### Scenario: The path in use is never ambiguous
- **WHEN** a session is running on any path
- **THEN** the application displays which path it is on

### Requirement: Pre-flight dependency check
A single command SHALL verify every external dependency the system uses, SHALL check all of
them regardless of earlier failures, and SHALL report the state of each.

#### Scenario: Several dependencies are down
- **WHEN** more than one dependency is unavailable
- **THEN** the check reports the state of every dependency in one run rather than stopping
  at the first failure

#### Scenario: A named model is verified, not assumed
- **WHEN** the check runs
- **THEN** it confirms the configured analysis model is available to the account, not only
  that a credential exists

#### Scenario: Device reachability is checked from the device
- **WHEN** the check is run for a demo
- **THEN** it verifies the gateway is reachable from the device on the network that will be
  used

### Requirement: Rehearsed demonstration script
A demonstration SHALL use a fixed scripted call whose expected detection point has been
established in advance by evaluation.

#### Scenario: The detection point is known before the demo
- **WHEN** the demonstration script is prepared
- **THEN** the turn at which the assessment is expected to reach its target band has been
  measured by the evaluation harness

#### Scenario: The script is reproducible
- **WHEN** the demonstration script is run more than once
- **THEN** the assessment reaches its target band at a consistent point

### Requirement: Consent is part of the demonstration
Any demonstration involving a live call SHALL obtain consent from all parties on the call
before monitoring begins, and that consent SHALL be recorded in the session.

#### Scenario: Consent is stated on a live call
- **WHEN** a live call is demonstrated
- **THEN** all parties are told the call is being transcribed and analysed before
  monitoring begins, and the session holds a consent record

### Requirement: Integration checkpoints
The system SHALL be exercised end to end at defined checkpoints before all components are
complete, with any incomplete component represented by its fake.

#### Scenario: A vertical slice runs before every track is done
- **WHEN** an integration checkpoint is reached
- **THEN** a session runs from audio source through transcription, assessment and event
  delivery to the application display, with fakes standing in for incomplete components

#### Scenario: A checkpoint failure is recorded
- **WHEN** a checkpoint does not pass
- **THEN** the failing seam is recorded with the tracks on either side of it

### Requirement: Documentation reflects what was built
Project documentation SHALL describe the paths that have actually carried a call and SHALL
NOT claim a capability that has not been run.

#### Scenario: A recorded decision is superseded
- **WHEN** a previously rejected approach has been built and verified
- **THEN** the documentation records the reversal, the reason, and the date

#### Scenario: An unverified path is marked unverified
- **WHEN** a path has been implemented but never run against its real service
- **THEN** the documentation states that it is unverified
