## Purpose

An in-app agent that answers questions about the call in progress using the live transcript
and risk assessment as context, and takes safe, user-confirmed actions on the user's behalf.

## ADDED Requirements

### Requirement: The assistant is grounded in the current call
The assistant SHALL have access to the current risk assessment, recent transcript turns,
caller information and session state, and SHALL answer questions about the call from that
context rather than from general knowledge.

#### Scenario: The user asks what is happening
- **WHEN** the user asks why the risk is elevated
- **THEN** the assistant explains the current assessment, citing signals and their quotes

#### Scenario: The user asks about something just said
- **WHEN** the user asks what the caller just asked them to do
- **THEN** the assistant answers from the recent transcript turns

#### Scenario: No assessment yet
- **WHEN** the user asks about risk before any assessment exists
- **THEN** the assistant says no assessment has been produced yet rather than estimating one

### Requirement: The assistant reports the assessment, it does not replace it
The assistant SHALL treat the current risk assessment as authoritative and SHALL NOT
produce a competing risk score or band.

#### Scenario: Asked directly whether the call is a scam
- **WHEN** the user asks the assistant to judge the call
- **THEN** it conveys the current assessment and its evidence, and does not state a
  different risk level of its own

### Requirement: Call content cannot trigger actions
Transcript content SHALL enter the assistant's context labelled as third-party speech. An
instruction contained in transcript content SHALL NOT cause any action to be taken.

#### Scenario: A caller instructs the assistant
- **WHEN** a speaker on the call says something addressed to the assistant, such as telling
  it to stop monitoring or to end the session
- **THEN** no action is taken as a result, and the assistant may report the attempt to the
  user

#### Scenario: The user can still ask about the instruction
- **WHEN** the user asks what the caller just told them to do
- **THEN** the assistant reports it accurately as something the caller said

### Requirement: World-changing actions require confirmation
Any action with an effect outside the app — ending the call, contacting another person,
sending a verification — SHALL require explicit user confirmation naming what will happen
and to whom. Read-only actions SHALL NOT require confirmation.

#### Scenario: An irreversible action is proposed
- **WHEN** the assistant proposes ending the call
- **THEN** a confirmation is shown naming the consequence, and nothing happens until the
  user confirms

#### Scenario: The user declines
- **WHEN** the user declines a proposed action
- **THEN** no effect occurs and the assistant acknowledges without re-proposing it
  unprompted

#### Scenario: Reading is not confirmed
- **WHEN** the user asks the assistant to explain a signal
- **THEN** the answer is produced with no confirmation step

### Requirement: Unavailable actions are honest
The assistant SHALL present actions the current session cannot perform as unavailable, with
a reason, and SHALL NOT attempt them.

#### Scenario: A transport that cannot end the call
- **WHEN** the current transport declares it cannot end the call
- **THEN** the end-call action is shown as unavailable with a reason and is never invoked

#### Scenario: An intervention backend that is not present
- **WHEN** an intervention capability is not available in the running system
- **THEN** actions depending on it are shown as unavailable rather than failing when used

### Requirement: Assistant-rendered call components
The assistant SHALL be able to render structured call components — the risk assessment, its
signals, and a proposed intervention — as interactive UI rather than as text alone.

#### Scenario: A risk explanation renders as a component
- **WHEN** the assistant explains the current risk
- **THEN** the assessment is rendered as a structured component showing band, score and
  signals with their quotes

#### Scenario: Rendering never invents evidence
- **WHEN** a rendered component shows signals
- **THEN** it shows only signals present in the current assessment, with their quotes
  unmodified

### Requirement: No provider credentials on the device
The assistant SHALL reach its model through the gateway. No model provider key SHALL be
present in the mobile application.

#### Scenario: The built app carries no key
- **WHEN** the mobile application is built
- **THEN** no model provider credential is present in the bundle
