## Why

The live risk score protects the person on the call. It does nothing for what happens
afterwards — reporting to the bank, disputing a transfer, warning a family member, or
recognising the same script when it calls the next person.

Everything needed is already emitted as session events: turns, assessments, signals with
verbatim quotes, caller reputation, and the intervention audit. What is missing is
assembling them into one artefact a person can act on, and the discipline about what is
kept and for how long.

## What Changes

- A **case file** assembled from the session event stream — not from a second source of
  truth. If it is not in the events, it is not in the case file.
- A risk **timeline**: every assessment with its score, band and what changed, so the
  trajectory is visible rather than only the final number. The trajectory is the
  interesting part and it is what a fraud team asks about.
- Evidence preserved with its quotes, timestamped and attributed to a speaker.
- The consent record, the caller reputation result, and the full intervention audit
  including declined and expired proposals.
- **Export** in two forms: a structured file for a system, and a readable summary a person
  can send to their bank.
- A **retention decision made explicitly**: what is kept, for how long, and a delete that
  actually deletes. A recording of someone being defrauded is sensitive in both directions.
- No audio retained by default. The transcript is the evidence; the audio is the liability.

## Capabilities

### New Capabilities
- `case-file`: the durable record of a monitored call — what was said, what was assessed,
  what was done — and the rules governing how long it survives.

## Impact

- New: `server/src/case-file/` and an endpoint the app links to from its post-call summary.
- Depends on: add-call-session-contracts. Assembles from events the other tracks emit, so
  it can be built against the fake gateway and gains detail as each track lands.
- No new external services. Storage is local for the hackathon; the retention requirements
  are written so that does not become an assumption baked into the interface.
