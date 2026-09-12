## 1. Provider interface

- [ ] 1.1 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Define a `ReputationProvider` interface returning a discriminated result —
      known-bad, checked-clean, unknown, unavailable; verify the four cases are distinct in
      the type and cannot collapse
- [ ] 1.2 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Implement a fixture provider returning scripted results per number; verify the
      mobile track can develop against it with no Twilio account
- [ ] 1.3 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Implement the local known-bad list checked before any external call; verify a
      listed number is flagged with the network disabled

## 2. Twilio Lookup

- [ ] 2.1 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Implement the Twilio Lookup provider fetching line type, carrier, caller name and
      portability indicators; verify against a real number
- [ ] 2.2 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Map failure, timeout and empty responses to unknown with a reason; verify by
      pointing the client at an unreachable host and asserting the result is unknown, never
      clean
- [ ] 2.3 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Return unavailable on transports with no far-end number; verify on replay and
      LiveKit sessions
- [ ] 2.4 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Cache by identifier with a bounded period; verify a repeat lookup makes no second
      external query, and that a list update still takes effect

## 3. Session integration

- [ ] 3.1 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Run the lookup at or before connection and publish `signal.caller`; verify it
      arrives before the first transcript turn on an inbound Twilio call
- [ ] 3.2 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Ensure the lookup never delays connection; verify a slow lookup still lets the
      call connect and publishes late
- [ ] 3.3 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Render the pre-answer verdict card in the app, including the unknown and
      unavailable states; verify all four result kinds display distinctly

## 4. Feeding the analyzer

- [ ] 4.1 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Add a caller-context section to the analysis prompt without changing
      `RISK_PROFILE_SCHEMA`; verify the analyzer's existing tests still pass
- [ ] 4.2 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Add an eval fixture: a benign call from a VoIP line with no other indicators;
      verify the assessment stays in the lowest bands — reputation alone must not raise risk
- [ ] 4.3 [DEFERRED - caller reputation / Twilio Lookup deferred; see proposal.md Scope as of now] Add an eval fixture where caller information contradicts the caller's claim;
      verify the contradiction can be reported as a signal with its transcript quote
