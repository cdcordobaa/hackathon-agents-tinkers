## 1. Policy — [UNCERTAIN, confirm scope before starting; see proposal.md Scope as of now]

- [ ] 1.1 Define the policy as a declarative table over band, signal types, elapsed time and
      transport capabilities; verify it evaluates against a recorded assessment with no
      model call
- [ ] 1.2 Run the benign-control fixtures from add-fraud-analysis-evaluation through the
      policy; verify zero interventions are proposed for any benign call
- [ ] 1.3 Run the fraud fixtures through the policy; verify the expected intervention is
      proposed before each fixture's labelled decisive turn

## 2. Proposal and confirmation — [UNCERTAIN, confirm scope before starting; see proposal.md Scope as of now]

- [ ] 2.1 Publish `intervention.proposed` with consequence and recipient named; verify the
      app renders it with both
- [ ] 2.2 Implement confirm, decline and expire-at-call-end; verify all three are recorded
      and only confirm executes
- [ ] 2.3 [SHAPE SUPERSEDED — no `canHangup` capability flag in the current
      `TranscriptSource`-based contract; hangup is deferred outright, see 3.5] Filter
      proposals by transport capability before publishing; verify a `canHangup: false`
      transport never sees an end-call proposal — reduces to: never propose end-call at
      all while 3.5 is deferred
- [ ] 2.4 Implement deduplication by (session, kind, target) with cooldown; verify a score
      rising across five passes proposes once
- [ ] 2.5 Re-propose a declined intervention only on material change; verify both branches
      against successive assessments

## 3. Intervention kinds

- [ ] 3.1 [DEFERRED - Twilio Verify deferred; see proposal.md Scope as of now] Determine
      what Twilio Verify supports on an inbound call and decide whether it steps up the
      caller or the user; verify the decision is recorded in design.md
- [ ] 3.2 [UNCERTAIN, confirm scope before starting] Implement the in-call spoken warning
      over `transport.speak` (now `<Say>`/`<Play>` on a Twilio call update — see
      `add-twilio-call-transport` task 3.5a; LiveKit has no live assessment to warn from
      in this scope, see `add-livekit-call-transport`'s Scope as of now); verify it is
      audible on a Twilio call
- [ ] 3.3 [DEFERRED - SMS deferred; see proposal.md Scope as of now] Implement the SMS to
      the user and to a pre-registered trusted contact; verify delivery and verify a send
      failure surfaces as failed, not done
- [ ] 3.4 [DEFERRED - Twilio Verify deferred, see 3.1] Implement Verify per the 3.1
      decision; verify a successful and a failed verification both record an outcome
- [ ] 3.5 [DEFERRED - "ending/hanging up the call" deferred; see proposal.md Scope as of
      now] Implement end-call over `transport.hangup`; verify the call terminates and the
      session seals normally
- [ ] 3.6 [UNCERTAIN — only meaningful if 3.2 ships] Enforce per-session caps per kind;
      verify the cap blocks further proposals

## 4. Pre-arming — [UNCERTAIN, confirm scope before starting]

Only the spoken warning is call-local and not itself deferred; see proposal.md Scope as
of now.

- [ ] 4.1 Implement arming for call-local interventions only; verify arming an SMS or an
      end-call is refused
- [ ] 4.2 Fire an armed intervention on its condition without confirmation and announce it;
      verify the user is informed and the audit records it as pre-armed
- [ ] 4.3 Measure detection-to-effect latency for the armed warning on a fraud fixture;
      verify the number is recorded and compare it against the confirm-first path

## 5. Audit

- [ ] 5.1 Record proposal, decision, execution and outcome with timestamps and the
      triggering assessment; verify a completed call's record contains every proposal
      including declined and expired ones
- [ ] 5.2 [DEFERRED - post-call case file deferred, see add-post-call-case-file's Scope
      as of now] Expose the audit to the case file; verify the case file's intervention
      section matches the audit exactly
