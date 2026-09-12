## 1. Shared contracts package

- [ ] 1.1 Create `shared/` as an ESM TypeScript package (`type: module`, `tsc --noEmit`
      typecheck script) referenced by `agent/`, `server/` and `mobile/`; verify all three
      typecheck clean against it
- [ ] 1.2 [PARTIALLY DEFERRED — `AudioFrame`/`TransportCapabilities`/`CallTransport`
      superseded by `TranscriptSource`, see `shared/README.md`'s Scope note] Define
      `Speaker`, `SessionState` and the client event union in `shared/src/` (done: see
      `shared/src/speaker.ts` and `shared/src/events.ts`); verify `tsc --noEmit` passes
      with no `any` in the public surface. Do not add `AudioFrame`, `TransportCapabilities`
      or `CallTransport` — `TranscriptSource`/`TranscriptSegment` in
      `shared/src/transcript-source.ts` is the actual seam
- [ ] 1.3 Re-export `RiskProfile`, `RiskLevel`, `Signal` and `RISK_PROFILE_SCHEMA` from
      `agent/src/risk-profile.ts` through `shared/`; verify the analyzer's existing tests
      still pass unchanged (`cd agent && npm test`)
- [ ] 1.4 [DEFERRED — superseded by Twilio Real-Time Transcription; no audio frames cross
      this boundary in the current scope, see `shared/README.md` Scope note] Add
      `rms(frame)` and a PCM16 resample helper with unit tests covering 8 kHz and 48 kHz
      inputs; verify a known sine wave round-trips within tolerance and a digitally silent
      buffer reports RMS 0

## 2. Replay transcript source

- [ ] 2.1 [SHAPE SUPERSEDED — implement as a `TranscriptSource` with `kind: 'replay'`
      (per `shared/src/transcript-source.ts`), not a `CallTransport`] Implement the replay
      source over `agent/src/fixtures/bank-scam.ts` with a speed multiplier; verify
      segments are delivered at the fixture's offsets divided by speed, in order, with no
      duplicate `providerEventKey`s
- [ ] 2.2 [DEFERRED — no transport-capability concept in the current scope; `TranscriptSource`
      has no `canSpeak`/`canHangup`] Declare replay capabilities as
      `canSpeak: false, canHangup: false`; verify the conformance suite's
      capability-honesty test passes
- [ ] 2.3 Confirm the replay `TranscriptSource` reproduces the output of the existing
      `agent/src/replay.ts` on the same fixture; verify by diffing the transcript turns
      produced by both

## 3. TranscriptSource conformance

- [ ] 3.1 [DEFERRED — audio-format assertions (sample rate, RMS) no longer apply; no
      `CallTransport` exists] Write `shared/src/transport-conformance.ts` exporting a
      suite runnable against any `CallTransport`; verify it fails on a deliberately broken
      stub (wrong sample rate, missing RMS, lying capability)
- [ ] 3.2 [DEFERRED — see 3.1] Run the suite against `ReplayTransport` under
      `node --import tsx --test`; verify it is green and wire it into `npm test`
- [ ] 3.3 [DEFERRED — see 3.1] Document in the suite's header that passing it is
      necessary and not sufficient for a live transport, and that each live adapter owns
      a real-service proof task
- [ ] 3.4 [NEW — replaces 3.1-3.3 for the current scope] Write a `TranscriptSource`
      conformance suite covering what `shared/README.md` flags as unexercised by the
      well-behaved replay fake: out-of-order `sequence` delivery, a repeated
      `providerEventKey` (dedup before `isFinal` is ever read), and a non-final segment
      for a speaker being replaced rather than appended; verify it fails against a
      deliberately naive source that trusts arrival order or double-appends a retried
      final
- [ ] 3.5 [NEW] Run the conformance suite from 3.4 against the replay `TranscriptSource`
      (well-behaved by construction) and against a second, deliberately hostile fake that
      shuffles and repeats segments (the one `shared/README.md` says does not exist yet);
      verify both are exercised and wire into `npm test`

## 4. Session state machine

- [ ] 4.1 Implement the `idle → awaiting-consent → running → ending → ended` machine with
      illegal transitions rejected; verify unit tests cover each illegal transition
- [ ] 4.2 [SHAPE SUPERSEDED — "audio frames" -> "transcript segments"] Implement the
      consent gate: drop and count incoming `TranscriptSegment`s until consent is
      recorded; verify a test asserts zero segments reach the transcript before consent
- [ ] 4.3 Record consent with timestamp and method, and expose it on the session; verify
      a test asserts the consent timestamp precedes the first transcript turn
- [ ] 4.4 Implement end-of-call flush so the final turns reach one last analysis pass
      (`ProgressiveAnalyzer.flush`); verify a test asserts a profile is produced after
      the transport ends

## 5. Silence detection

- [ ] 5.1 [DEFERRED — superseded by Twilio Real-Time Transcription; there is no audio
      stream to measure RMS on. `transcript.degraded` (`shared/src/events.ts`) already
      covers "Twilio's transcription callback going quiet or degraded for that leg" — see
      its doc comment] Implement the RMS window monitor emitting `audio.silent` and its
      recovery event; verify tests cover an all-zero stream, a speech-level stream, and a
      stream that goes quiet then recovers
- [ ] 5.2 [DEFERRED — see 5.1] Make the silence threshold and window configurable with
      documented defaults; verify defaults are exercised by the replay path without false
      positives
- [ ] 5.3 [NEW — replaces 5.1/5.2] Implement the stall/degradation detector that emits
      `transcript.degraded` per speaker (dropped/stalled callback, or a speaker present
      with no segments arriving); verify with a fixture that stops posting segments for
      one leg while the other continues

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

- [ ] 7.1 [NOTE — likely the same object as the replay `TranscriptSource` in section 2;
      implement once, not twice] Implement `FakeTranscriber` that turns replay fixture
      text into transcript turns without any model call; verify the gateway produces
      turns with no API key set
- [ ] 7.2 Implement `FakeAnalyzer` producing a rising risk score on a fixed schedule;
      verify the mobile track can see a score climb with no OpenAI key
- [ ] 7.3 Add `npm run dev:fake` in `server/` starting a gateway on replay + both fakes;
      verify a documented one-liner brings up a session a phone can subscribe to

## 8. Handoff gate

- [ ] 8.1 Write `shared/README.md` naming each seam, its owning track, and its fake;
      verify every interface in `shared/src/` appears in it
- [ ] 8.2 [UPDATED CRITERIA — audio conformance suite deferred, see section 3] Verify the
      gate for unblocking Phase 1: the `TranscriptSource` conformance suite (task 3.4/3.5)
      green against the replay source, `npm run dev:fake` serving a subscribable session,
      and `shared/` typechecking from `agent/`, `server/` and `mobile/`
