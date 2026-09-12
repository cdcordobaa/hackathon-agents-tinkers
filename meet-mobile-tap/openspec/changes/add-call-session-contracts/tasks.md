## 1. Shared contracts package

- [ ] 1.1 Create `shared/` as an ESM TypeScript package (`type: module`, `tsc --noEmit`
      typecheck script) referenced by `agent/`, `server/` and `mobile/`; verify all three
      typecheck clean against it
- [ ] 1.2 Define `AudioFrame`, `Speaker`, `TransportCapabilities`, `CallTransport`,
      `SessionState` and the client event union in `shared/src/`; verify `tsc --noEmit`
      passes with no `any` in the public surface
- [ ] 1.3 Re-export `RiskProfile`, `RiskLevel`, `Signal` and `RISK_PROFILE_SCHEMA` from
      `agent/src/risk-profile.ts` through `shared/`; verify the analyzer's existing tests
      still pass unchanged (`cd agent && npm test`)
- [ ] 1.4 Add `rms(frame)` and a PCM16 resample helper with unit tests covering 8 kHz and
      48 kHz inputs; verify a known sine wave round-trips within tolerance and a
      digitally silent buffer reports RMS 0

## 2. Replay transport

- [ ] 2.1 Implement `ReplayTransport` over `agent/src/fixtures/bank-scam.ts` with a speed
      multiplier; verify turns are delivered at the fixture's offsets divided by speed
- [ ] 2.2 Declare replay capabilities as `canSpeak: false, canHangup: false`; verify the
      conformance suite's capability-honesty test passes
- [ ] 2.3 Confirm `ReplayTransport` reproduces the output of the existing
      `agent/src/replay.ts` on the same fixture; verify by diffing the transcript turns
      produced by both

## 3. Transport conformance suite

- [ ] 3.1 Write `shared/src/transport-conformance.ts` exporting a suite runnable against
      any `CallTransport`; verify it fails on a deliberately broken stub (wrong sample
      rate, missing RMS, lying capability)
- [ ] 3.2 Run the suite against `ReplayTransport` under `node --import tsx --test`;
      verify it is green and wire it into `npm test`
- [ ] 3.3 Document in the suite's header that passing it is necessary and not sufficient
      for a live transport, and that each live adapter owns a real-service proof task

## 4. Session state machine

- [ ] 4.1 Implement the `idle → awaiting-consent → running → ending → ended` machine with
      illegal transitions rejected; verify unit tests cover each illegal transition
- [ ] 4.2 Implement the consent gate: drop and count audio frames until consent is
      recorded; verify a test asserts zero transcription calls before consent
- [ ] 4.3 Record consent with timestamp and method, and expose it on the session; verify
      a test asserts the consent timestamp precedes the first transcript turn
- [ ] 4.4 Implement end-of-call flush so the final turns reach one last analysis pass
      (`ProgressiveAnalyzer.flush`); verify a test asserts a profile is produced after
      the transport ends

## 5. Silence detection

- [ ] 5.1 Implement the RMS window monitor emitting `audio.silent` and its recovery
      event; verify tests cover an all-zero stream, a speech-level stream, and a stream
      that goes quiet then recovers
- [ ] 5.2 Make the silence threshold and window configurable with documented defaults;
      verify defaults are exercised by the replay path without false positives

## 6. Session gateway

- [ ] 6.1 Create `server/` with a `SessionRegistry` addressing sessions by opaque id;
      verify two concurrent sessions do not cross-talk in a test
- [ ] 6.2 Implement the WebSocket endpoint with sequence-numbered event fan-out; verify a
      test subscriber receives a contiguous sequence with no gaps
- [ ] 6.3 Implement late-subscribe replay of current state plus latest risk profile;
      verify a subscriber joining mid-session receives state before any new event
- [ ] 6.4 Implement resume-from-sequence, including the explicit "backlog unavailable"
      response; verify both branches are tested
- [ ] 6.5 Release transport, timers and registry entry on `ended`; verify a test asserts
      no timer keeps the process alive after a session ends

## 7. Fakes for parallel tracks

- [ ] 7.1 Implement `FakeTranscriber` that turns replay fixture text into transcript
      turns without any model call; verify the gateway produces turns with no API key set
- [ ] 7.2 Implement `FakeAnalyzer` producing a rising risk score on a fixed schedule;
      verify the mobile track can see a score climb with no OpenAI key
- [ ] 7.3 Add `npm run dev:fake` in `server/` starting a gateway on replay + both fakes;
      verify a documented one-liner brings up a session a phone can subscribe to

## 8. Handoff gate

- [ ] 8.1 Write `shared/README.md` naming each seam, its owning track, and its fake;
      verify every interface in `shared/src/` appears in it
- [ ] 8.2 Verify the gate for unblocking Phase 1: conformance suite green against replay,
      `npm run dev:fake` serving a subscribable session, and `shared/` typechecking from
      `agent/`, `server/` and `mobile/`
