## Purpose

Acting on a fraud assessment while the call is still happening — warning, verifying,
alerting, or ending — with the user in the loop and a complete record of what was proposed,
decided and done.

## ADDED Requirements

### Requirement: Interventions are proposed from a declared policy
The system SHALL derive proposed interventions from a declarative policy over the current
assessment, the signals present, and the transport's capabilities. The policy SHALL be
inspectable and testable without invoking a model.

#### Scenario: A rising assessment produces a proposal
- **WHEN** an assessment reaches a band the policy associates with an intervention
- **THEN** that intervention is proposed and published as a session event

#### Scenario: A low-risk call produces no proposals
- **WHEN** an assessment reports the lowest risk bands
- **THEN** no intervention is proposed

#### Scenario: Policy behaviour is testable offline
- **WHEN** the policy is evaluated against a recorded assessment
- **THEN** the proposed interventions are determined without any model call

### Requirement: Execution requires user confirmation
An intervention SHALL NOT take effect outside the application until the user confirms it,
except for a pre-armed intervention under its armed condition. A confirmation SHALL name
what will happen and who will be affected.

#### Scenario: A proposal waits for the user
- **WHEN** an intervention is proposed
- **THEN** nothing takes effect until the user confirms, and the proposal names its
  consequence and recipient

#### Scenario: A declined proposal has no effect
- **WHEN** the user declines a proposed intervention
- **THEN** it is not executed and it is recorded as declined

#### Scenario: An unanswered proposal expires
- **WHEN** a proposal is neither confirmed nor declined before the call ends
- **THEN** it is recorded as expired and never executed

### Requirement: Pre-armed interventions
The user MAY arm an intervention before the call to execute automatically under a named
condition. Only interventions whose effect is limited to the call itself SHALL be armable.
Ending the call and contacting another person SHALL NOT be armable.

#### Scenario: An armed warning fires inside the decisive window
- **WHEN** the armed condition is met during a call
- **THEN** the intervention executes without waiting for confirmation and the user is
  informed that it fired

#### Scenario: Interventions affecting other people cannot be armed
- **WHEN** the user attempts to arm an intervention that contacts another person or ends
  the call
- **THEN** arming is refused

#### Scenario: An unarmed condition still proposes
- **WHEN** the condition is met but nothing was armed
- **THEN** the intervention is proposed for confirmation as normal

### Requirement: Only performable interventions are proposed
The system SHALL check the transport's declared capabilities before proposing an
intervention, and SHALL NOT propose one the current session cannot perform.

#### Scenario: A transport that cannot end the call
- **WHEN** the transport declares it cannot end the call
- **THEN** ending the call is never proposed for that session

#### Scenario: A transport that cannot speak
- **WHEN** the transport declares it cannot speak into the call
- **THEN** an in-call warning is never proposed for that session

### Requirement: Deduplication and rate limiting
The system SHALL propose each intervention kind at most once per call per target within a
cooldown, and SHALL NOT re-propose one the user declined unless the assessment reports a
material change.

#### Scenario: A rising score does not repeat a proposal every pass
- **WHEN** successive assessments continue to satisfy the same policy rule
- **THEN** the intervention is proposed once, not once per assessment

#### Scenario: A declined proposal returns only on material change
- **WHEN** the user has declined an intervention and the assessment later reports a
  material change
- **THEN** it may be proposed again, and otherwise is not

#### Scenario: A per-session cap is enforced
- **WHEN** the number of executed interventions of a kind reaches its per-session cap
- **THEN** no further interventions of that kind are proposed or executed

### Requirement: Every intervention is announced
The system SHALL inform the user when an intervention executes, including pre-armed ones,
and SHALL inform the user when one fails.

#### Scenario: An executed intervention is visible
- **WHEN** an intervention executes
- **THEN** the user is shown what was done

#### Scenario: A failed intervention is not reported as done
- **WHEN** an intervention fails to execute
- **THEN** the user is shown that it failed and what did not happen

### Requirement: Audit trail
Every proposal, decision, execution and outcome SHALL be recorded with its timestamp, the
assessment that triggered it, and the user's decision, and SHALL be available to the
session's case file.

#### Scenario: A complete intervention history
- **WHEN** a call ends
- **THEN** every proposed intervention appears in the record with its decision and outcome,
  including those declined and expired
