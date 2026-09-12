## Context

`agent/` already has the two hard parts of the pipeline working: `RollingTranscript`
(finals only, bounded render) and `ProgressiveAnalyzer` (skip-if-nothing-new,
never-overlap, bounded-prompt). What does not exist is anything that feeds them from a
real call, or anything that carries the result to a phone.

The constraint that shapes every decision here is in CLAUDE.md: `@livekit/react-native`
hands you tracks to *render*, not raw PCM in JS. So audio cannot be analysed on the
device — transcription and analysis live server-side, and the phone is a client of a
session it does not own. That is also the right answer for key hygiene, and it happens
to be the only shape that lets Twilio (where audio never touches the phone at all) and
LiveKit share one design.

See proposal.md — Why for motivation.

## Goals / Non-Goals

**Goals**
- One seam per track, each with a working fake, so four people can work without blocking.
- An audio contract narrow enough that "does this adapter work" is a test, not an opinion.
- The replay path is a first-class transport, not test scaffolding.

**Non-Goals**
- Authentication, multi-tenancy, or persistence beyond the process. One session at a
  time survives a hackathon demo; a session registry keyed by id is enough shape to not
  repaint later.
- Horizontal scale. The gateway is one Node process.
- Transport-native recording. The case file is assembled from events we already emit.

## Decisions

### Audio normalises at the adapter boundary, to PCM16 mono 24 kHz

Every transport converts before emitting. Twilio hands over μ-law 8 kHz, LiveKit Opus at
48 kHz, replay synthesises nothing at all. Downstream — transcription, RMS gating, the
case file — sees one format.

*Why not carry the native format and convert at the consumer?* Because then every consumer
grows a codec matrix, and the transcription track (B) would be blocked on both transport
adapters landing. Converting once, in the adapter, is what keeps A and B independent.

The cost is real and must be measured, not assumed: Twilio's μ-law 8 kHz upsampled to
24 kHz does not recover the missing band, and STT accuracy on it is an open question
(see add-twilio-call-transport).

### Every frame carries an RMS, and the session gates on it

CLAUDE.md's most expensive failure mode: Android's concurrent-capture policy does not
stop a capture, it *silences* it — the recorder reports success and returns zeros. A
transport that emits 10,000 frames of digital silence looks exactly like one that works.

So `AudioFrame.rms` is not optional and not a debug field. The session raises
`audio.silent` after a configurable window of sub-threshold frames, and the mobile HUD
shows it. This is the one piece of observability that is cheaper to build now than to
add while debugging at 2am.

### Transport capabilities are data, not duck-typing

`canSpeak` and `canHangup` are booleans on the transport, not optional methods the caller
probes with `typeof`. The intervention track (D) needs to render "warn the caller" as
unavailable rather than discover it by throwing, and the demo needs to degrade visibly.

Replay: neither. LiveKit: can speak (publish a track), cannot hang up a PSTN leg.
Twilio: both.

### The client never talks to the model, and never holds a provider key

Phone → gateway WebSocket → session. The gateway holds the OpenAI key, the Twilio
credentials and the LiveKit secret. `mobile/.env` keeps only the gateway URL and a
session token.

This also retires the current `EXPO_PUBLIC_LIVEKIT_TOKEN` hand-minting, which bakes a
long-lived token into the bundle (`scripts/mint-token.mjs` exists precisely because there
is no token server yet). add-livekit-call-transport replaces it.

### Consent is a state in the session machine, not a checkbox in the UI

`idle → awaiting-consent → running → ended`. The session drops audio frames on the floor
until consent is recorded, and the recording is part of the case file. Putting it in the
state machine rather than the UI means no track can accidentally ship a path around it,
and the case file can prove consent was obtained before the first analysed turn.

### One `RiskProfile`, re-exported

`agent/src/risk-profile.ts` is described in its own header as the swappable file. Moving
it would break that. `shared/` re-exports the type and the JSON schema instead, so the
mobile HUD and the case file import from `shared/` while the analyzer keeps owning the
definition.

## Risks / Trade-offs

- **The conformance suite tests the adapter, not the network.** An adapter can pass every
  test and still never receive a packet from Twilio. → The suite asserts on *observed
  non-silent audio* for live transports, and each transport change carries its own
  "prove it against the real service" task that a green unit test does not satisfy.
- **A shared package on day one is overhead if the team is two people in one file.** → It
  is four people across `mobile/`, `agent/` and `server/`, which is exactly the case where
  the alternative is three copies of `RiskProfile` that drift by the afternoon.
- **The gateway is a single point of failure for the demo.** → The fallback ladder in
  add-integration-and-demo runs replay in the same process, so a dead Twilio or LiveKit
  does not take the demo with it. A dead gateway does.
- **Fakes let a track "finish" against something that never existed.** → Integration
  checkpoints are scheduled in add-integration-and-demo rather than left to the end.

## Migration Plan

Nothing is deployed; there is nothing to migrate. `agent/src/replay.ts` keeps working
throughout — `ReplayTransport` wraps the same fixture, and `npm run replay` stays the
fastest way to see the analyzer move. The old script is removed only once the transport
version produces identical output on the same fixture.

## Open Questions

- Gateway HTTP framework: Hono or plain `node:http`. Either is fine; whoever writes it
  picks, and the choice does not reach any other track.
- Whether `Speaker.role` (`subject` / `counterparty`) can be inferred reliably on the
  LiveKit path, where both parties are just participants. Twilio gets it free from the
  leg direction. Deferred to add-livekit-call-transport; the field exists either way and
  may hold `unknown`.
