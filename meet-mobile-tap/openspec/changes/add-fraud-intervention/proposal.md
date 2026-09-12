## Scope as of now

Three of the four intervention types this proposal defines are individually on the
deferred list: **SMS** (to the user or a trusted contact), **Twilio Verify**
(step-up identity), and **ending the call** (hangup). Only the **in-call spoken
warning** (via `<Say>`/`<Play>`, independent of transcription) is not on the deferred
list — see `add-twilio-call-transport`'s Scope as of now, which keeps `speak` in scope
while deferring `hangup`.

This leaves the propose/confirm policy framework itself — section 1 (policy),
section 2 (proposal and confirmation), the spoken-warning half of section 3, and
pre-arming (section 4) — **uncertain rather than deferred**: nothing in the scope
decisions explicitly says the intervention *framework* is in or out for this build, only
that three of its four mechanisms are. Confirm with whoever owns this track before
starting; if only the spoken warning ships, the framework may be more than the moment
needs. Section 5 (audit) is blocked on 5.2, which feeds the case file — deferred
separately.

The specs below still describe the full original intent (all four intervention types) —
see `tasks.md` for the per-task tags.

## Why

A risk score that only informs is a product that watches someone get defrauded and takes
notes. The moment that matters in a vishing call is narrow — between "read me the code you
just received" and the victim reading it — and it is measured in seconds. Something has to
act inside that window.

It is also the point of maximum danger for the product. An automated action on a false
positive hangs up on someone's actual bank, or sends an alarming SMS to their daughter
about a call that was fine. So the design question is not "what can we automate" but "what
can be proposed fast enough to be useful and confirmed safely enough to be shippable".

## What Changes

- A **policy** mapping the assessment to proposed interventions: which action, at which
  risk band, on which signal types. Declarative and reviewable, not scattered conditionals.
- **Proposal, then confirmation.** The system proposes; the user confirms. Interventions
  reach the world only through an explicit user decision, surfaced in the HUD and through
  the assistant.
- Intervention types: an in-call spoken warning, Twilio Verify to step up the caller's or
  the user's identity, an SMS to the user or a pre-registered trusted contact, and ending
  the call.
- **Capability-aware degradation**: an intervention whose transport cannot perform it is
  never proposed. Replay can do none of them; LiveKit can speak but not hang up.
- Idempotency and rate limits, so a rising score across successive passes cannot send four
  SMS messages about one call.
- A full audit trail — proposed, confirmed or declined, executed, result — feeding the case
  file.
- One automatic exception, explicitly bounded: a **pre-armed** action the user configured
  before the call, which fires without confirmation only in a defined condition and is
  always announced.

## Capabilities

### New Capabilities
- `intervention`: acting on a fraud assessment while the call is still happening, with the
  user in the loop.

## Impact

- New: `server/src/intervention/` — policy, executor, audit.
- `call-transport`: uses the declared `canSpeak` and `canHangup` capabilities.
- `assistant`: intervention actions become available; before this change they render as
  unavailable.
- Requires Twilio credentials for Verify and Messaging on the gateway. Both are billed.
- Depends on: add-call-session-contracts. Twilio-backed interventions additionally need
  add-twilio-call-transport for call control; SMS and Verify work independently of transport.
