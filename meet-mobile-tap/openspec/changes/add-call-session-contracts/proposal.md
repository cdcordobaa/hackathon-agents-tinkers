## Why

Four tracks need to start at the same hour, and three of them (mobile UI, detection,
intervention) cannot begin until they know what a call session looks like from the
outside. Without one set of shared types and one fake behind every seam, the tracks
serialise behind whoever is wiring audio, and integration lands at 3am on demo day.

This change is the only blocking one. It buys parallelism: after it merges, every
other track can run the whole pipeline end to end on the `replay` transport with no
LiveKit account, no Twilio number, and no microphone.

## What Changes

- New `shared/` TypeScript package holding every cross-track contract: `CallSession`,
  `CallTransport`, `AudioFrame`, `Speaker`, the client event protocol, and a re-export
  of the existing `RiskProfile` from `agent/src/risk-profile.ts` so there is exactly one
  definition of the analysis result.
- `CallTransport` interface with a **normalised** audio contract — PCM16 mono 24 kHz,
  every frame stamped with an RMS. Transports differ in wire format (Twilio is μ-law
  8 kHz, LiveKit is Opus); none of that escapes the adapter.
- Optional transport capabilities (`canSpeak`, `canHangup`) declared as data, so the
  intervention track can degrade instead of crashing on a transport that cannot talk back.
- `ReplayTransport` — drives the existing `agent/src/fixtures/bank-scam.ts` script through
  the real pipeline at configurable speed. This is the third call path, not a test double:
  it is the demo's last-resort fallback.
- A **transport conformance suite** that every adapter must pass. LiveKit and Twilio are
  then judged against the same tests rather than against whether they threw.
- `server/` session gateway skeleton: a `SessionRegistry`, a WebSocket endpoint, and
  event fan-out, shipped with `FakeTranscriber` and `FakeAnalyzer` so the mobile track
  sees a rising risk score on day one without an OpenAI key.
- A consent gate: a session refuses to emit audio downstream until consent is recorded.

## Capabilities

### New Capabilities
- `call-session`: the lifecycle of one monitored call — start, consent, running, ended —
  and the event protocol the mobile client subscribes to.
- `call-transport`: the contract every call path implements, including the normalised
  audio format and the conformance suite that defines "this adapter works".

### Modified Capabilities

None — this is the first change; nothing exists to modify.

## Impact

- New: `shared/`, `server/`.
- `agent/`: `RollingTranscript` and `ProgressiveAnalyzer` are consumed by the session
  rather than driven by `replay.ts` directly. `risk-profile.ts` moves its type exports
  behind `shared/` re-exports; no schema or prompt change.
- `mobile/`: gains a gateway WebSocket client. The existing LiveKit screen is untouched
  by this change.
- Blocks: every other change in this plan. Nothing else should start until the conformance
  suite is green against `ReplayTransport`.
