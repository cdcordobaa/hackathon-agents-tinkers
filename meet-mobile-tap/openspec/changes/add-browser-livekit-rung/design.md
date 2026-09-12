## Context

The specs as written route every transcript through Twilio's `<Start><Transcription>`
callbacks. LiveKit was kept only as a call path — `shared/README.md` says outright that
it "has no implementation in this scope" for transcription. That was a reasonable
narrowing when Twilio was assumed reliable, but it means the fallback ladder's bottom
rung (LiveKit, no phone number, no tunnel) demos a connected call with a dead HUD. A
fallback that cannot show the product is not a fallback.

The fix does not touch the hard parts of the pipeline. `RollingTranscript` and
`ProgressiveAnalyzer` already consume `TranscriptSegment`-shaped input through
`TranscriptSource`; that seam does not care whether a segment came from a Twilio webhook
or a browser tab, only that it is well-formed and honestly sequenced. What is missing is
a source of segments on the LiveKit path, and LiveKit already hands us the one thing that
makes this cheap: every participant is already its own track, so speaker separation is
free — there is no diarization step to build, unlike a mixed-audio source.

The starter kit (`../agents-everywhere-starter-kit/apps/web`) already solved
"transcribe live audio in a browser tab without answering back" for its own voice
feature: `transcription-session.ts` is a DOM-independent Realtime WebSocket client, and
`stereo-capture.ts` proves the AudioWorklet pattern for pulling PCM16 out of a live
`AudioContext` graph. Both are MIT and in the same workspace. This change is mostly
plumbing those two files into a new small app that joins a LiveKit room instead of
opening a tab-capture dialog.

## Goals / Non-Goals

**Goals**
- Make the LiveKit rung demo-complete on its own: join a room, see the transcript, see
  the risk HUD move — no phone number, no carrier, no tunnel, no Twilio account.
- Reuse the starter kit's listening-session and PCM-extraction code with minimal
  adaptation, preserving attribution.
- Produce exactly the `TranscriptSegment` shape `shared/src/transcript-source.ts`
  already defines, so nothing downstream of `TranscriptSource` changes.
- Name and spec the one new risk this path introduces — a client POSTing transcript
  segments is untrusted input in a way a provider webhook (Twilio's signed callback) is
  not — rather than let it be discovered live during integration.

**Non-Goals**
- Building the gateway's `BrowserTranscriptSource` or ingest route. This change specs
  the contract; implementing it waits on `server/` existing, per the sequencing note in
  proposal.md.
- Solving general WebRTC-room transcription for N participants. Two participants (a
  demo call) is the target; more than two is not excluded by the design but is not tested.
- A production-grade auth system for the browser app. The session token the gateway
  already mints for a call session (per `add-call-session-contracts`) is reused as-is.
- Replacing Twilio. This is an additional rung, not a migration — `add-twilio-call-transport`
  and `add-live-transcription` are unaffected.

## Decisions

### Transcription happens in the browser, not on a server-side LiveKit agent worker

`add-livekit-call-transport`'s original (now-superseded) design put a LiveKit agent
worker server-side to subscribe to tracks and emit `AudioFrame`s, because that scope
assumed a uniform audio pipeline across transports. That worker does not exist and is
out of scope for the current plan. Standing one up now — a headless LiveKit participant
process, server-side audio decoding, a second STT integration point — is a lot of new
surface for a fallback path, on a clock measured in hours.

Transcribing in the tab that is already joining the room needs none of that: the browser
already has decoded audio for every remote track (that is what makes it playable), and
`stereo-capture.ts` already proves the extraction pattern. The cost is that the OpenAI
Realtime ephemeral secret has to reach the browser, which is the same trust shape the
starter kit already runs in production for its own voice page.

*Rejected alternative*: server-side LiveKit agent worker mirroring the original
call-session-contracts design. Rejected for time: it duplicates infrastructure the
browser gets for free, and the whole point of T5 is to be the cheap, reliable rung.

### One `TranscriptionSession` per remote participant, no stereo merge

`stereo-capture.ts` merges two sources (mic + tab) into one stereo graph specifically so
both channels are sample-aligned from the same render quantum. That problem does not
exist here: LiveKit already delivers each remote participant as a separate
`MediaStreamTrack`, so there is nothing to merge and no ordering ambiguity to solve by
merging. Each track gets its own `AudioContext` tap, its own mono AudioWorklet instance,
and its own `openTranscriptionSession`. This is simpler than the source it's ported from,
not just a port of it.

*Rejected alternative*: mix all remote tracks into one stream and diarize. Rejected
because it reintroduces the exact problem LiveKit's per-participant tracks let every
other transport avoid, for zero benefit — the tracks are already separate.

### Segments are POSTed, not streamed over a second WebSocket

The browser already has a session id and (per `add-call-session-contracts`) a way to
reach the gateway. A `POST` per finalized (and, optionally, per in-progress) segment is
simplest and matches the shape `TranscriptSource` already expects — no new protocol,
just an HTTP call carrying a `TranscriptSegment`. A WebSocket back-channel would need its
own reconnect/backoff logic that duplicates what `TranscriptSource` implementations
already have to handle on the read side.

*Rejected alternative*: opening a second WebSocket from the browser to the gateway for
segment delivery. Rejected as unnecessary machinery — segments are discrete, ordered
events with a `sequence` field built for exactly this kind of at-least-once delivery;
HTTP POST-and-retry is enough.

### The trust boundary is enforced at ingest, not assumed away

Every other `TranscriptSource` in this project either runs entirely inside the gateway
process (`replay`) or receives a provider-authenticated callback (Twilio signs its
webhook). This is the first source where the thing POSTing a segment is code the gateway
does not control, running on a machine the gateway does not control, claiming to speak
for a specific session. Two things follow, and both are requirements in the spec, not
just a design note:

1. The POST must be bound to a specific, authorised session id — the same session token
   already minted for that browser to join the LiveKit room, not a bare session id an
   attacker could guess or copy from a URL.
2. A segment for a session the caller is not authorised for must be refused outright, not
   merged, not logged-and-dropped-silently in a way indistinguishable from a dropped
   packet — the caller needs to know the write did not happen.

*Rejected alternative*: trust any POST that names a valid session id, on the theory that
the risk is a fraud-detection demo, not a bank. Rejected because "an unrelated tab can
inject fabricated transcript into someone else's live risk assessment" is a real
integrity failure regardless of stakes, and the fix (bind to an authorised token) is
cheap relative to the failure it prevents.

## Risks / Trade-offs

- **A client-supplied segment is untrusted input.** Covered above and in the spec's
  dedicated requirement; this is the one genuinely new risk class T5 introduces relative
  to every other `TranscriptSource`.
- **The OpenAI Realtime ephemeral secret is now minted for a browser tab, not just a
  server process.** It is short-lived by design (the same mechanism the starter kit
  already uses), but a browser tab is a larger attack surface than a Node process. →
  Mitigate by keeping the secret's TTL short and scoping it to transcription-only (the
  ported session already asks for `type: "transcription"`, which cannot generate a
  spoken reply even if the secret leaked).
- **Two independent Realtime WebSocket connections per demo call doubles the external
  dependency surface** (LiveKit *and* two OpenAI Realtime sockets) relative to the
  Twilio path (Twilio's transcription callback is one dependency). → Accepted: this path
  exists specifically as an alternative when Twilio itself is the thing failing, and
  OpenAI Realtime failing is a different, independently-recoverable failure to report
  via the same `transcript.degraded` event `add-live-transcription` already specs.
- **The browser app is a new thing to build, test, and keep working under demo
  pressure**, on top of `mobile/`'s CopilotKit build already in flight. → Mitigate by
  keeping `web/` genuinely standalone (its own `package.json`, no coupling to `mobile/`'s
  Expo toolchain) so it cannot destabilize the CopilotKit or LiveKit-iOS work in progress
  elsewhere.
- **This spec is written before `server/` exists**, so the ingest route's exact request
  shape is necessarily provisional. → Mitigated by specifying it in terms of the
  `TranscriptSegment` type `shared/` already fixes, so the actual wire shape has almost
  no freedom left to get wrong when it's implemented.

## Migration Plan

Nothing is deployed; there is nothing to migrate. This is a pure addition: a new `web/`
app, a new `TranscriptSource` implementation, and a new ingest route. No existing
transport, event shape, or type in `shared/` changes. If this rung is never finished
before the demo, the product still runs on Twilio or on `agent/`'s replay fallback
exactly as before — nothing here is load-bearing for either of those.

## Open Questions

- Where the OpenAI Realtime ephemeral secret is minted for the browser: a new
  `POST /session/:id/realtime-secret` on the gateway, mirroring the LiveKit token
  endpoint `add-livekit-call-transport` specs, is the obvious answer but is not this
  change's to build — whoever implements the gateway side picks the route shape.
  Deferred to that implementation task.
- Whether in-progress (non-final) segments are POSTed at all, or only finals. Posting
  only finals is simpler and matches "only finals enter the transcript" exactly; posting
  deltas too would let a HUD show live in-progress text the way it already can for other
  sources, at the cost of more POSTs per second. Left to the implementer; either choice
  is a valid `TranscriptSource`.
- How role (`subject` / `counterparty`) is assigned per browser participant when there is
  no leg direction to read it from. The likely answer mirrors
  `add-livekit-call-transport`'s room-identity rule (the identity the gateway issued to
  the protected user is `subject`, everyone else `counterparty`), but this change does
  not depend on that being resolved — `unknown` is always a valid fallback per
  `shared/src/speaker.ts`.
- Whether two demo participants must be on the same LAN/network path to keep LiveKit
  latency low enough for a live demo, or whether LiveKit Cloud's routing already makes
  this a non-issue. Not verified; flag for whoever runs the first end-to-end rehearsal.
