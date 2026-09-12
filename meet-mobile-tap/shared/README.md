# shared

The contracts every other track codes against. Nobody in `mobile/`, `server/` (once it
exists) or `agent/` should redefine a shape that lives here — import it instead. If a
shape needs to change, change it here and let `tsc --noEmit` in the consumers find every
place that now disagrees.

This package has no runtime code and no dependencies. It is types, a JSON schema, and one
interface. If you find yourself wanting to add a function with a body, ask whether it
belongs in `agent/` or `server/` instead — `shared/` is the seam, not an implementation.

## Scope note

This package was originally sketched for an audio-based `CallTransport` (PCM16 frames,
RMS-based silence detection) — see `openspec/changes/add-call-session-contracts/`. That
sketch predates the current decision: **transcript comes from Twilio's real-time
transcription callbacks** (`<Start><Transcription>` + a callback URL that POSTs
speaker-labelled segments). Twilio does the speech-to-text. There is no audio WebSocket,
no mu-law decoding, and no in-process STT anywhere in this scope, so there is no
`AudioFrame` type and no `CallTransport` audio contract here — only `TranscriptSource`,
which is what actually exists to build against. LiveKit remains a call-only rung with no
transcript source in this pass.

## Seams

### `Speaker` — `src/speaker.ts`

The participant model. `role` is `subject | counterparty | unknown`. **Owner: whoever
wires each transcript source** — Twilio's leg direction gives `subject`/`counterparty`
for free; a source that cannot tell MUST report `unknown` rather than guess, because a
wrong guess flips who a risk signal quotes. No fake needed — it's a plain value.

### The event protocol — `src/events.ts`

`SessionEvent` (server → client) and `ClientMessage` (client → server). **Owner: the
gateway** (`server/`, not yet built) is the only thing that emits `SessionEvent`s and
accepts `ClientMessage`s; the mobile app is a pure consumer. Everything is a
discriminated union on `type` so both sides can `switch` exhaustively, and a client can
safely ignore an event type it doesn't recognise yet.

Every server → client event carries `sessionId`, `seq` (increments by exactly 1, no
gaps — a resuming client's way to detect a hole) and `atMs` (the session clock, not wall
time). The five event types in this scope: `session.state`, `transcript.turn`,
`risk.updated`, `transcript.degraded`, `error`. Client → server: `session.start`,
`session.end`, `consent.granted`, `consent.declined`, `subscribe`.

**Fake:** none shipped in this package — the gateway hasn't been built yet. The nearest
thing to a fake today is `agent/src/replay.ts`, which produces the same
`RiskProfile`/transcript-turn shapes this protocol wraps, just without a socket around
them. Whoever builds `server/`'s fake gateway should emit real `SessionEvent` values from
day one so the mobile client never codes against something the real gateway won't send.

**Decision to respect:** `ClientMessage` carries no `sessionId` field. The design this
implements (`add-call-session-contracts/design.md`) is "phone → gateway WebSocket →
session" — one session per socket — so the connection itself is the addressing. If a
future change multiplexes sessions on one socket, that's a breaking change to this type,
not an additive one; don't bolt an optional `sessionId` on quietly.

### `TranscriptSource` — `src/transcript-source.ts`

The seam between a call path and the transcript. **Owner: whoever wires Twilio's
transcription callbacks implements `kind: 'twilio'`; the replay fixture implements
`kind: 'replay'`** (adapting `agent/src/fixtures/bank-scam.ts` — see
`agent/src/replay.ts` for the existing non-`TranscriptSource` version of the same idea).
`kind: 'livekit'` is declared for completeness but has no implementation in this scope —
LiveKit is call-only and emits no transcript.

**The two fields that exist because Twilio is unreliable, not for elegance:**
`sequence` and `providerEventKey`. Twilio's real-time transcription POSTs segments out of
order and sometimes twice (a correction re-posts, a retry resends). `sequence` is what
you sort by; `providerEventKey` is what you dedup on, *before* you look at `isFinal`. A
`TranscriptSource` implementation that ignores either one will look correct against the
replay fixture (which is well-behaved) and scramble or double-count turns the moment it
faces real Twilio traffic.

**Fake:** a `TranscriptSource` built over `agent/src/fixtures/bank-scam.ts`
(`kind: 'replay'`) — deterministic, in-order, no duplicate `providerEventKey`s, so it
exercises the interface without exercising the reason half of it exists. Anyone testing
dedup/reorder logic needs a second, deliberately-hostile fake that shuffles and repeats
segments; that fake does not exist yet and is not this package's job to write.

### `RiskProfile` and friends — `src/risk.ts`

Re-exports `RiskLevel`, `Signal`, `RiskProfile`, `RISK_PROFILE_SCHEMA` from
`agent/src/risk-profile.ts`. **Owner: `agent/` — this file is a pointer, not a
definition.** `agent/src/risk-profile.ts` calls itself out as THE SWAPPABLE FILE; if the
product's analysis target ever changes, that file changes and this re-export follows it
automatically. Nothing here has its own fake — importing the same schema the analyzer
actually returns *is* the fake-avoidance strategy: there is no second copy to fall out of
sync.

## Everything exported, and from where

| Export | File |
|---|---|
| `Speaker`, `SpeakerRole` | `src/speaker.ts` |
| `SessionState` | `src/events.ts` |
| `SessionEventEnvelope` | `src/events.ts` |
| `SessionStateEvent` | `src/events.ts` |
| `TranscriptTurnEvent` | `src/events.ts` |
| `RiskUpdatedEvent` | `src/events.ts` |
| `TranscriptDegradedEvent` | `src/events.ts` |
| `ErrorEvent` | `src/events.ts` |
| `SessionEvent` (union of the five above) | `src/events.ts` |
| `ClientMessage` | `src/events.ts` |
| `TranscriptSourceKind` | `src/transcript-source.ts` |
| `TranscriptSegment` | `src/transcript-source.ts` |
| `TranscriptSourceStartContext` | `src/transcript-source.ts` |
| `TranscriptSourceStopReason` | `src/transcript-source.ts` |
| `Unsubscribe` | `src/transcript-source.ts` |
| `TranscriptSource` | `src/transcript-source.ts` |
| `RiskLevel`, `Signal`, `RiskProfile`, `RISK_PROFILE_SCHEMA` | `src/risk.ts` (re-exported from `agent/src/risk-profile.ts`) |

All of the above are re-exported from `src/index.ts` — import from `shared/src/index.ts`
(or wherever your consumer's path mapping points), never reach into a submodule directly,
so a future reshuffle of files inside `src/` doesn't ripple into every consumer.

## Verifying this package

```bash
cd shared
npm install     # only devDependency is typescript
npm run typecheck
```

A green typecheck here also proves the `risk.ts` re-export actually resolves against
`agent/src/risk-profile.ts` on disk — if that file moves or renames an export, this
package fails to typecheck before any consumer does.
