## Scope as of now

**[DEFERRED, not cancelled — superseded by Twilio Real-Time Transcription]** Our own
speech-to-text ("our own STT over `<Start><Stream>`") is on the deferred list. The
current transcript source is Twilio's own real-time transcription callback
(`<Start><Transcription>` posting speaker-labelled segments) — see `add-twilio-call-transport`'s
scope note. `shared/src/transcript-source.ts` (already on disk) is explicit that "there
is no raw audio, no mu-law decode and no in-process STT anywhere behind this interface"
in the current scope, and that `kind: 'livekit'` "has no transcript source in this pass —
LiveKit stays a call-only rung". That means this entire change — porting the starter
kit's `TranscriptionSession`, feeding it `AudioFrame`s, running one STT session per
speaker — has no current wiring point on either transport: Twilio bypasses it by
transcribing itself, and LiveKit has no transcript path to feed it in this scope.

The specs below and the tasks in `tasks.md` still describe the full original intent —
this is the change to revisit if Twilio's built-in transcription proves insufficient, or
if LiveKit later needs live detection of its own. Every task is marked deferred rather
than removed for that reason.

## Why

`RollingTranscript` is written, tested and fed by a replay script. Nothing connects real
call audio to `transcript.final()`. CLAUDE.md lists this plainly under Unverified:
"Speech-to-text is not wired at all." Until it is, every live path ends at a stream of
PCM nobody reads.

The web sibling already solved the hard part.
`../agents-everywhere-starter-kit/apps/web/src/lib/transcription-session.ts` is a plain
WebSocket client with no DOM dependency — a listening session that transcribes without
ever answering back — and should port to the gateway nearly unchanged.

## What Changes

- A `TranscriptionSession` in the gateway: one streaming speech-to-text connection per
  speaker, fed normalised frames, emitting deltas and finals.
- Wiring into `RollingTranscript` that respects the rule already encoded there: only
  finals enter the transcript, deltas are held separately and replaced rather than appended.
- One session per speaker, so speaker attribution comes from the transport rather than from
  diarization — free on LiveKit (one track per participant) and on Twilio (one per leg).
- Reconnection with backoff, and explicit reporting when a speaker's transcription is down,
  because a dead STT socket produces exactly the same transcript as a silent room.
- A `transcript.turn` event on the session stream, so the mobile client can show the
  conversation and the case file can be assembled from events.
- A latency budget measured end to end: speech → final → available to the analyzer.

## Capabilities

### New Capabilities
- `transcription`: turning attributed call audio into speaker-labelled final turns, and
  reporting honestly when it cannot.

## Impact

- New: `server/src/transcription/`, ported from the starter kit's web implementation
  (MIT, same workspace).
- `agent/`: `RollingTranscript` gains a real producer. No change to its logic — the delta
  and final semantics it already implements are exactly what the streaming API provides.
- Requires `OPENAI_API_KEY` on the gateway only.
- Depends on: add-call-session-contracts. Runs in parallel with both transport changes by
  developing against `ReplayTransport` and the fixture's audio.
