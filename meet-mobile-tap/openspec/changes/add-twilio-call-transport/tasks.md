## 1. Account, and the reason Twilio was rejected

- [ ] 1.1 Upgrade the Twilio account off trial and buy a voice-capable number; verify by
      placing a real call and confirming no "you have a trial account" preamble plays —
      this is the specific ground on which CLAUDE.md rejected this path
- [ ] 1.2 Do 1.1 at least 24 hours before the demo and record the date in CLAUDE.md;
      verify the call is made from the number that will be used on stage
- [ ] 1.3 Set a spend alert on the account; verify the alert fires on a test threshold

## 2. Webhooks and real-time transcription

- [ ] 2.1 Expose the gateway publicly (tunnel or deploy) and point the number's voice
      webhook at it; verify an inbound call hits the endpoint and is answered
- [ ] 2.2 [SHAPE SUPERSEDED — `<Start><Transcription>` replaces `<Start><Stream>`; see
      proposal.md Scope as of now] Return TwiML that forks audio with
      `<Start><Stream track="both_tracks">`; verify the media WebSocket connects and
      receives payloads
- [ ] 2.3 [DEFERRED — superseded by Twilio Real-Time Transcription; Twilio never sends us
      audio, so there is nothing to decode or resample] Decode μ-law and resample 8 kHz →
      PCM16 mono 24 kHz; verify a captured sample plays back intelligibly and the
      conformance format assertion passes
- [ ] 2.4 [DEFERRED — see 2.3; no media stream to have a single mixed track on] Reject a
      single mixed track with an explicit error; verify by configuring a single-track
      stream and asserting the error rather than merged speakers
- [ ] 2.5 [NEW — replaces 2.2] Return TwiML that starts real-time transcription with
      `<Start><Transcription track="both_tracks" statusCallbackUrl="..." />` pointed at a
      gateway endpoint; verify Twilio calls the status callback confirming the
      transcription started
- [ ] 2.6 [NEW] Implement the transcription callback handler (`POST` endpoint Twilio
      calls with each speaker-labelled segment); verify it receives partial and final
      segments for a real call and returns 200 promptly so Twilio does not retry
      spuriously
- [ ] 2.7 [NEW] Implement the status callback handler for transcription
      start/stop/failure; verify a deliberately malformed `<Start><Transcription>`
      (bad callback URL) surfaces as a reported failure rather than silence
- [ ] 2.8 [NEW] Map each transcription callback payload into a `TranscriptSegment`
      (`shared/src/transcript-source.ts`): sort/dedup using the payload's own sequencing
      and event-id fields onto `sequence` and `providerEventKey`; verify against Twilio's
      documented out-of-order and duplicate-delivery behaviour with a captured or
      simulated payload set

## 3. Twilio TranscriptSource

- [ ] 3.1 [SHAPE SUPERSEDED — `CallTransport` no longer exists; implement as a
      `TranscriptSource` with `kind: 'twilio'` per `shared/src/transcript-source.ts`, per
      `shared/README.md`'s "Owner: whoever wires Twilio's transcription callbacks"] Implement
      `TwilioTransport` against `CallTransport`; verify the shared conformance suite
      passes — use the `TranscriptSource` conformance suite added in
      `add-call-session-contracts` tasks 3.4/3.5 instead
- [ ] 3.2 Map leg direction (the transcription callback's `Track` field) to `subject` /
      `counterparty`; verify a two-party call yields correctly-roled speaker ids in the
      transcript
- [ ] 3.3 [DEFERRED — superseded by Twilio Real-Time Transcription; there is no separate
      "our STT on Twilio audio" path to compare against a wideband path, since Twilio does
      its own transcription end to end] Measure narrowband cost: transcribe the same
      speech via the Twilio path and via a wideband path, and record word error rate for
      both; verify the numbers are written into design.md's Decisions section
- [ ] 3.4 [NEW — replaces 3.3] Measure Twilio's real-time transcription quality and
      latency directly against the scripted scam fixture (accuracy of key phrases,
      time from speech to callback); verify the numbers are recorded in design.md's
      Decisions section, since this is now the only STT step in the Twilio path and its
      quality is the analyzer's ceiling
- [ ] 3.5 [SHAPE SUPERSEDED — "media stream pausing" -> "transcription callback going
      stale"] Implement stall detection separate from silence; verify by pausing the media
      stream mid-call and asserting a transport error — reimplement as: no transcription
      callback (partial or final) for a configurable timeout while the call is still up is
      a `transcript.degraded` condition (see `add-call-session-contracts` task 5.3), not a
      media-stream error
- [ ] 3.6 [NEW — the `speak` half of the original 3.5, which is split in two] Implement
      speak via `<Say>`/`<Play>` on a call update; verify it is audible on a real call and
      inert after the call has ended
- [ ] 3.7 [DEFERRED — "ending/hanging up the call" deferred; see proposal.md Scope as of
      now; the `hangup` half of the original 3.5] Implement hangup; verify the call
      terminates and the session seals normally

## 4. Mobile leg (time-boxed spike) — [UNCERTAIN, confirm before starting]

Not explicitly on the deferred list, but the scope decision keeps CopilotKit
native-module-free specifically to avoid a second `expo prebuild`/`pod install` cycle
breaking the LiveKit iOS build (see `add-copilot-fraud-assistant`'s Scope as of now).
This section adds a *different* native telephony module to the same app for the same
underlying risk. `design.md` already frames it as "not on the critical path: the gateway
can place and monitor a call with no app changes at all" — confirm with whoever owns the
mobile track whether it is still worth spending the time box on before starting 4.1.

- [ ] 4.1 Spike `@twilio/voice-react-native-sdk` in `mobile/`: check for an Expo config
      plugin, run `npx expo prebuild`, and verify `ios/*.xcworkspace` exists — per
      CLAUDE.md, `prebuild` exits 0 even when `pod install` failed, so the exit code is
      not evidence
- [ ] 4.2 Place or receive a call from the app; verify audio is two-way on a physical
      device, not the Simulator
- [ ] 4.3 If the spike exceeds its time box, stop and record the outcome: the transport
      works with the phone dialling in from its native dialer, and the app leg is dropped
      from the demo rather than the transport

## 5. End-to-end proof

- [ ] 5.1 Run a full session on the Twilio transport against a scripted scam call placed
      from a second phone; verify risk profiles arrive on the gateway WebSocket
- [ ] 5.2 Verify the whole path once more on demo-day network conditions, with the tunnel
      URL that will be live on stage
