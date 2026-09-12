## Purpose

What can be established about the other party before they say anything — line type, carrier,
recent number changes, known-bad listings — and how confidently, so that a claim made on the
call can be weighed against the circumstances of the call.

## ADDED Requirements

### Requirement: Pre-speech caller lookup
The system SHALL attempt to establish caller information for the far-end identifier at or
before connection, and SHALL publish the result as a session event before the first
transcript turn where the identifier is known in advance.

#### Scenario: An inbound call is looked up before it is answered
- **WHEN** a call arrives with a far-end number
- **THEN** a caller reputation result is published before the first transcript turn

#### Scenario: Lookup does not delay the call
- **WHEN** the lookup has not completed by the time the call connects
- **THEN** the call proceeds and the result is published when it arrives

### Requirement: Known-bad list is checked first
The system SHALL check the far-end identifier against a local list of known fraudulent
numbers before any external query, and a match SHALL be reported without requiring an
external service.

#### Scenario: A listed number is flagged offline
- **WHEN** the far-end number appears on the local list
- **THEN** it is reported as known-bad with its listing reason and no external query is
  required

#### Scenario: An unlisted number proceeds to lookup
- **WHEN** the far-end number is not on the local list
- **THEN** the external lookup is attempted

### Requirement: Absent information is reported as unknown
The system SHALL distinguish "no risk indicators found" from "could not determine". A
failed, unavailable, unsupported or empty lookup SHALL be reported as unknown and SHALL NOT
be presented as a clean result.

#### Scenario: The lookup service is unreachable
- **WHEN** the external lookup fails or times out
- **THEN** the result is reported as unknown with the reason, and no clean or low-risk
  verdict is implied

#### Scenario: A transport with no number
- **WHEN** the session runs on a path where no far-end number exists
- **THEN** caller reputation is reported as unavailable for that session

#### Scenario: A genuinely clean number
- **WHEN** the lookup succeeds and finds no risk indicators
- **THEN** the result is reported as checked with no indicators found, distinct from unknown

### Requirement: Reputation is context, not a verdict
Caller information SHALL be provided to the risk assessment as context. The system SHALL
NOT treat any single caller attribute as sufficient evidence of fraud, and SHALL NOT raise
a risk band on caller attributes alone.

#### Scenario: A VoIP line by itself is not fraud
- **WHEN** the only available indicator is that the far end is a non-mobile or VoIP line
- **THEN** the risk assessment does not report elevated or higher risk on that basis alone

#### Scenario: Reputation strengthens a transcript signal
- **WHEN** a caller claims to represent an organisation and the caller information
  contradicts that claim
- **THEN** the contradiction may be reported as a signal alongside the transcript evidence

### Requirement: Results are cached per identifier
The system SHALL cache lookup results by identifier for a bounded period and SHALL reuse a
cached result rather than re-querying within it.

#### Scenario: Repeated calls from the same number
- **WHEN** the same number is looked up again within the cache period
- **THEN** the cached result is used and no additional external query is made

#### Scenario: Known-bad listings are not stale-cached past a change
- **WHEN** the local list is updated
- **THEN** subsequent lookups reflect the update regardless of cached external results
