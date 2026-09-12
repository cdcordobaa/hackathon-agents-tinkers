## Why

As currently planned, the transcript comes from Twilio's real-time transcription
callbacks (`add-live-transcription`, `add-twilio-call-transport`). LiveKit is kept as a
call path, but nothing produces a transcript on it — `shared/README.md` says this
outright: "LiveKit is call-only and emits no transcript." That makes LiveKit a rung that
*looks* like it works and does not: a judge sees a connected call and a level meter, and
the risk HUD stays dead, because nothing ever calls `RollingTranscript.final()`.

That is backwards for a hackathon fallback. The rung that is supposed to work when Twilio
does not — no trial-account preamble, no carrier, no tunnel — is the one rung that cannot
show the product's actual output. This change fixes that by moving speech-to-text into
the browser: two participants in a LiveKit room (two tabs, or a tab plus the phone) *is*
the call, each participant's track is transcribed separately in the browser using the
starter kit's existing listening-session code, and the resulting segments are POSTed to
the gateway in the shared `TranscriptSegment` shape. The phone subscribes to the same
session and renders the identical HUD it would for a Twilio call.

The reuse is what makes this affordable this late in the day.
`../agents-everywhere-starter-kit/apps/web/src/lib/transcription-session.ts` is already a
listen-only OpenAI Realtime client with no DOM dependency, and
`../agents-everywhere-starter-kit/apps/web/src/lib/stereo-capture.ts` already solves
PCM16 extraction from a live audio graph via an AudioWorklet. Neither needs to be
invented; both need a browser page to run in and a POST at the end instead of a local
render.

## What Changes

- A new standalone app at `web/` (Vite + `livekit-client`) that joins a LiveKit room as a
  participant. It is not part of `mobile/` and not part of `server/` — it is a browser
  page a person opens in a second tab, or on a laptop across from the phone.
- Per-remote-participant transcription: because each LiveKit participant publishes its
  own track, speaker separation is free — there is no diarization step, and no stereo
  merge like the starter kit's tab-plus-mic capture, because there is no shared tab audio
  to split. Each remote `MediaStreamTrack` is tapped independently and fed to its own
  `openTranscriptionSession` (ported from `transcription-session.ts`, retaining
  attribution).
- A minimal AudioWorklet, adapted from `stereo-capture.ts`'s worklet, that resamples one
  track to PCM16 mono at whatever rate the browser's `AudioContext` gives it and hands
  off fixed-size frames — the mono half of that file's stereo-tap trick, not the merge.
- Segment POSTing: each `delta`/`completed` event from a transcription session becomes a
  `TranscriptSegment` (shared/src/transcript-source.ts shape) and is POSTed to a new
  gateway ingest route, tagged with the session id and the LiveKit participant identity
  the gateway already knows about.
- One gateway addition: a `BrowserTranscriptSource` (`kind: 'livekit'` in
  `TranscriptSourceKind` — the union already reserves this value) plus the ingest route
  that feeds it. This is explicitly a small extension of the *same* `TranscriptSource`
  seam T1/T2 are building for Twilio, not a parallel mechanism — it implements the same
  interface with segments arriving from a client POST instead of a provider webhook.
- A trust boundary the Twilio path does not have: a client-supplied segment is untrusted
  input. The ingest route MUST bind an incoming segment to a session id the caller is
  authorised for and MUST refuse a segment for a session it does not own. This is the one
  genuinely new risk this change introduces — see design.md and the spec's dedicated
  requirement.
- No change to `RollingTranscript`, `ProgressiveAnalyzer`, or the wire protocol in
  `shared/src/events.ts`: `BrowserTranscriptSource` emits the same `TranscriptSegment`
  shape every other source emits, so everything downstream of `TranscriptSource` is
  already built.

## Capabilities

### New Capabilities
- `browser-call-rung`: joining a LiveKit room from a browser, transcribing each
  participant's track locally, and delivering speaker-labelled segments to a call
  session as an authorised, session-bound `TranscriptSource`.

## Impact

- New: `web/` — a standalone Vite app, not built or served by `mobile/` or `server/`.
  `web/src/lib/transcription-session.ts` and `web/src/lib/audio-capture.ts` are ports of
  the two starter-kit files named above (MIT, same workspace; attribution retained in
  each file's header).
- New on the gateway (`server/`, once it exists): `server/src/transports/browser.ts`
  (`BrowserTranscriptSource`, `kind: 'livekit'`) and `POST /session/:id/segments` (or
  equivalent) as the ingest route, including the authorization check described above.
- No change to `shared/`: `TranscriptSourceKind` already lists `'livekit'`;
  `TranscriptSegment` already carries everything a browser-produced segment needs
  (`speakerId`, `role`, `text`, `isFinal`, `sequence`, `providerEventKey`, `atMs`). If
  `role` cannot be determined for a LiveKit participant, this path reports `unknown`,
  matching the rule `shared/src/speaker.ts` already states.
- Requires a client-side OpenAI Realtime ephemeral secret, minted by the gateway per
  browser session — the browser never holds a long-lived API key, mirroring the decision
  already made for LiveKit room tokens in `add-livekit-call-transport`.
- Depends on: `add-call-session-contracts` (for `TranscriptSource` and the session
  registry) and `add-live-transcription` (this change ports the same upstream file to a
  different runtime; the two should not diverge on the wire event shapes they produce).
  Runs in parallel with `add-twilio-call-transport` — the two transports never share code
  below the `TranscriptSource` interface.
- **Sequencing constraint, not a technical dependency**: the one gateway-side piece this
  change needs — `BrowserTranscriptSource` plus the ingest route — must wait until the
  T1/T2 workflow currently building `server/` releases it. This proposal specs the
  contract now so that release is a small, well-defined addition rather than a blocker
  discovered late.
