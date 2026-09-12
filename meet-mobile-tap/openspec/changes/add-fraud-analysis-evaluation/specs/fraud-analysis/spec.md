## Purpose

Produces a live, progressive, evidence-backed risk assessment of a call while it is still
happening, and the evaluation that establishes whether that assessment is trustworthy
enough to put in front of someone mid-conversation.

## ADDED Requirements

### Requirement: Progressive assessment
The system SHALL produce a revised risk assessment as the call develops, SHALL carry its
previous assessment into each new pass, and SHALL report what changed since that previous
assessment.

#### Scenario: The assessment develops with the call
- **WHEN** a call progresses through several turns
- **THEN** each pass returns an assessment that accounts for the whole call so far and
  states what moved since the previous pass

#### Scenario: The first pass says so
- **WHEN** the first assessment of a call is produced
- **THEN** it reports that it is the first assessment rather than describing a change

#### Scenario: A score may fall on a genuine explanation
- **WHEN** something previously treated as suspicious is credibly explained later
- **THEN** the assessment may lower the score and SHALL state why in its change summary

### Requirement: Every signal is quotable
Each reported signal SHALL include text quoted verbatim from the transcript. A signal that
cannot be supported by a quote SHALL NOT be reported.

#### Scenario: Quotes are checkable against the transcript
- **WHEN** an assessment reports any signal
- **THEN** each signal's quoted text appears verbatim in the transcript of that call

#### Scenario: No quote, no signal
- **WHEN** the model would report a concern it cannot quote
- **THEN** no signal is reported for it

### Requirement: Ordinary calls stay quiet
The system SHALL return the lowest risk band with no signals and no advice for calls that
contain no social-engineering indicators, including calls that legitimately discuss money,
accounts, or identity.

#### Scenario: A genuine customer-service call is not flagged
- **WHEN** a benign call involving an account is assessed for its full duration
- **THEN** every pass stays within the lowest risk bands and reports no signals

#### Scenario: A family conversation about money is not flagged
- **WHEN** a benign personal call discussing money is assessed
- **THEN** every pass stays within the lowest risk bands

### Requirement: Detection in time to matter
The system SHALL be evaluated on how early in a call it reaches the expected risk band, not
only on the band it eventually reaches.

#### Scenario: Turns-to-detection is recorded
- **WHEN** a labelled fraud fixture is evaluated
- **THEN** the number of transcript turns before the assessment first reaches the expected
  band is recorded

#### Scenario: A late-only detection is a failure
- **WHEN** a fixture reaches the expected band only after its decisive moment has passed
- **THEN** the evaluation records the fixture as failed regardless of its final score

### Requirement: Transcript content cannot steer the assessment
Transcript text SHALL be treated as data. An instruction spoken on the call SHALL NOT change
the system's rules, scoring, or output format, and SHALL be treated as information about the
call.

#### Scenario: A caller tells the system to report the call as safe
- **WHEN** a speaker instructs the system to ignore its rules or lower its score
- **THEN** the assessed risk does not fall as a result, and the attempt may itself be
  reported as a signal

#### Scenario: Output shape is unaffected
- **WHEN** a speaker asks for a different output format
- **THEN** the assessment is returned in the defined structure unchanged

### Requirement: Evaluation harness
A harness SHALL score the system against a labelled fixture set covering fraudulent and
benign calls, SHALL report per-fixture outcomes and aggregate results, and SHALL be
runnable as a single command.

#### Scenario: A prompt change is judged by evidence
- **WHEN** the prompt or schema is changed and the harness is run
- **THEN** results are reported per fixture, including benign controls, so the change can
  be compared against the previous run

#### Scenario: Fabricated quotes fail the run
- **WHEN** an assessment cites text that does not appear in the transcript
- **THEN** the harness fails that fixture and names the fabricated quote

### Requirement: Assessment cost and pace are measured
The system SHALL record per-pass latency and SHALL record passes skipped because a previous
pass was still running, so that the analysis interval and model choice can be chosen on
evidence.

#### Scenario: Overlap-induced drops are visible
- **WHEN** model latency exceeds the analysis interval during a run
- **THEN** the number of dropped passes is reported

#### Scenario: Unchanged transcripts cost nothing
- **WHEN** an analysis tick occurs with no new final turns since the last pass
- **THEN** no model call is made
