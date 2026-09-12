## Context

The analyzer produces a profile every few seconds with a band, a score, quoted signals and
advice written to be read mid-call. What does not exist is anything that turns that into an
effect. See proposal.md — Why.

The constraint that shapes this design: a false positive here is visible to other people.
Every other part of the system fails privately.

## Goals / Non-Goals

**Goals**
- Close the gap between detection and effect to seconds, without automating away the user.
- Make the safe thing the easy thing: nothing reaches the world unconfirmed by default.
- A complete audit trail, because the case file's value depends on it.

**Non-Goals**
- Blocking the call, filtering audio, or interposing on the conversation. The user is an
  adult on their own phone.
- Reporting to a bank or authority. That is what the case file is for, and it is a
  post-call decision.
- Learning thresholds from outcomes. There is no outcome data and there will not be by
  Saturday.

## Decisions

### Propose, then confirm — with one bounded exception

Default: the system proposes, the user confirms, then it executes. This is the only design
that survives a false positive in front of judges, and it matches how the analyzer already
writes `advice` — as an action for a person to take.

The bounded exception is **pre-arming**: before the call, the user may arm exactly one
action to fire automatically under a named condition — for example, "if risk reaches high
and a one-time code is requested, play the warning". It fires without confirmation, is
always announced to the user as it happens, and is always in the audit trail.

*Why have the exception at all?* Because the decisive window in an OTP scam is shorter than
the time it takes a pressured person to read a confirmation dialog, and the warning is the
one action whose false-positive cost is low — an interrupted sentence. Ending a call or
messaging a relative is never pre-armable.

### Policy is declarative

A table from (band, signal types present, elapsed time, transport capabilities) to a
proposed action. Written as data so it can be read in review and exercised in tests without
running a model, and so the demo's behaviour is predictable rather than emergent.

### Never propose what cannot be done

The proposer filters on declared transport capabilities before anything reaches the UI.
Proposing "end the call" on a transport that cannot end calls teaches the user the product
is unreliable, and it is avoidable with data that already exists.

### Idempotency by intent, not by request

A rising score fires the same policy rule on consecutive passes. Deduplication is keyed on
(session, intervention kind, target) with a cooldown — so "SMS the trusted contact" is
proposed once per call, not once per pass. A user who declines is not re-asked unless the
situation materially changes; `changed` in the profile is what "materially" means.

### Interventions are announced to the user, always

Including the pre-armed one, and including failures. A spoken warning the user does not know
about makes them think the caller heard a third voice. An SMS that failed to send must not
leave the user believing their contact was alerted.

## Risks / Trade-offs

- **False positive with an external effect.** → Confirmation by default; pre-arming limited
  to the lowest-cost action; the benign-control fixtures in add-fraud-analysis-evaluation
  are run against the policy, not just against the analyzer.
- **Confirmation is too slow in the decisive window.** → Pre-arming exists precisely for
  this, and the demo measures detection-to-effect latency rather than claiming it.
- **A pressured user confirms anything put in front of them.** → Confirmations name the
  consequence and the recipient in plain language, and the destructive ones are visually
  distinct from the safe ones.
- **Twilio Verify and Messaging cost money per attempt and are rate-limited upstream.** →
  Cooldowns and per-session caps, plus a spend alert.
- **An in-call warning tips off a sophisticated fraudster.** → Accepted; protecting the user
  in the moment beats evidence collection, and the case file already has the transcript.

## Migration Plan

Additive and independently shippable. Until this lands, the assistant renders intervention
actions as unavailable, which is already specified behaviour. Interventions can ship one
kind at a time — warning first, since it has the lowest blast radius and works on LiveKit.

## Open Questions

- Whether the trusted contact is configured in-app or hard-coded for the demo. Demo-scoped;
  does not change the interface.
- Whether Verify is aimed at the caller (prove you are the bank) or the user (step up before
  a transaction). The first is the better story and the harder integration. Decided in task
  3.1 against what Twilio Verify actually supports on an inbound call.
