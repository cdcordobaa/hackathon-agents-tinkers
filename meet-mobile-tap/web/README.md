# `web/` — the browser rung (T5)

> **Legacy browser-STT harness.** The current unified demo is `../agent/web/`, served with its
> `/api/health` and `/api/join` gateway by `../agent/` on port 8787. It shares a LiveKit room and
> monitor snapshots with the mobile app. This directory is the earlier experimental harness that
> transcribes inside the browser; it has its own tokens, processes, and ports and is not required
> for the unified browser ↔ mobile demo.

Why this exists, in one line: **Twilio is cut** (no paid account, no purchased number, no
tunnel, no time), so the LiveKit path needs its own transcript producer or it demos a
connected call with a dead risk HUD. This app transcribes every participant's audio track
*in the browser* and POSTs the segments to the gateway — the full product demos with
nothing but a browser and a model key.

Standalone Vite + vanilla TypeScript app. Not built or served by `mobile/` or `server/`;
those are owned by other workflows and this app only ever *reads* their code
(`shared/src/*.ts` types, `agent/src/fixtures/bank-scam.ts` data).

## Layout

    web/
      src/
        main.ts                    operator screen — DOM wiring only
        config.ts                  env defaults + localStorage-persisted inputs
        script-pane.ts             renders agent/src/fixtures/bank-scam.ts
        participant-pipeline.ts    per-participant: level meter + transcription + segments
        livekit/room.ts            join room, surface every participant's audio track
        gateway/session-client.ts  POST /session, then drive it to `running` over WS
        gateway/transcript-poster.ts  batch-POST segments, retry with backoff, same keys
        lib/transcription-session.ts  ported from the starter kit (MIT, attribution kept)
        lib/track-tap.ts           adapted from the starter kit's stereo-capture.ts
        lib/realtime-config.ts     adapted from the starter kit (VITE_ instead of NEXT_PUBLIC_)
      scripts/mint-token.mjs       LiveKit token minting, same shape as mobile/scripts/
      token-server/server.mjs      stand-in for a gateway-minted OpenAI ephemeral secret

## How to run

Three processes, three terminals. All from `web/`:

```bash
npm install
cp .env.example .env        # fill in the values below
```

**1. LiveKit room + token.** Fill `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
in `.env` (same three values `mobile/.env` already has — copy them), then:

```bash
npm run token -- --room demo --identity browser
```

This writes `VITE_LIVEKIT_URL` / `VITE_LIVEKIT_TOKEN` / `VITE_LIVEKIT_ROOM` /
`VITE_LIVEKIT_IDENTITY` into `.env`. Mint a **second** token with a different
`--identity` (e.g. `--identity phone`, or just open the app in a second tab and paste a
second `--identity browser2` token) so two participants are ever in the room — see "Two
participants" below.

**2. The token-server** (mints short-lived OpenAI Realtime secrets so the real API key
never reaches the browser bundle):

```bash
echo 'OPENAI_API_KEY=sk-...' >> .env
npm run token-server
```

**3. The gateway** (see `../server/README.md` if present, or just `cd ../server && npm
install && npm run dev` — needs a model key in `server/.env` or `agent/.env`, per that
package). **As of this writing the gateway has no `livekit` transport and no segment
ingest route** — see "What the next agent needs to build" below. The app still runs
without it; it just cannot get the session past `POST /session`, which shows up as a
clear error in the Connect panel, not a silent failure.

**4. The app:**

```bash
npm run dev
```

Open the printed URL. The Connect panel is pre-filled from `.env` (via
`import.meta.env`); every field is also a plain text input, editable and saved to
`localStorage`, so a token or URL can be pasted live at demo time without a rebuild.

## Two participants in a room, for a demo

Any of these work — "two clients in a LiveKit room" is the whole requirement:

- Two browser tabs, each with a token minted for the same `--room` and different
  `--identity`. One person plays "You" (reads nothing — they're the mark), the other
  plays "Caller" and reads the **Script pane** on screen.
- This tab plus the phone (`mobile/`), same room name, each with its own token.

Either way, whoever plays the caller should read straight from the Script pane — it is
the exact `agent/src/fixtures/bank-scam.ts` pretext the eval fixtures use, so the demo
lands at a known moment (the OTP ask, at the very end) instead of improvising.

## Env vars

| Var | Read by | Purpose |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `scripts/mint-token.mjs` (Node, not bundled) | Mint a room token |
| `VITE_LIVEKIT_URL`, `VITE_LIVEKIT_TOKEN` | the app | Room connection — also a visible, pasteable input |
| `VITE_LIVEKIT_ROOM`, `VITE_LIVEKIT_IDENTITY` | the app | Defaults for the Room/Identity inputs |
| `VITE_GATEWAY_URL` | the app | Gateway base URL (default `http://localhost:8787`) |
| `VITE_TOKEN_SERVER_URL` | the app | Token-server base URL (default `http://localhost:8788`) |
| `VITE_TRANSCRIBE_MODEL` | the app + token-server | OpenAI Realtime transcribe model (default `gpt-live-transcribe`) |
| `OPENAI_API_KEY` | `token-server/server.mjs` (Node, not bundled) | **Never** `VITE_`-prefix this — it must not reach the browser |
| `TOKEN_SERVER_PORT` | `token-server/server.mjs` | Default 8788 |

## Verify

```bash
npx tsc --noEmit   # passes
npm run build      # passes — vite build, ~575 kB single chunk (mostly livekit-client)
```

Confirmed: `dist/` contains no `OPENAI_API_KEY` and no `sk-` string (grepped after
build) — the real key lives only in the token-server process's env, never in the bundle,
satisfying the spec's "no long-lived transcription credential reaches the browser"
requirement.

## The exact `TranscriptSegment` this app emits

Shape is `shared/src/transcript-source.ts`'s `TranscriptSegment`, unchanged — read that
file, this is not a paraphrase:

```ts
{
  speakerId: string;      // the LiveKit participant identity, verbatim
  role: "subject" | "counterparty";   // local participant -> subject, everyone else -> counterparty
  text: string;           // for isFinal:false, the FULL accumulated in-progress turn —
                           // NOT the latest delta fragment (OpenAI's delta event gives
                           // fragments; participant-pipeline.ts accumulates them, because
                           // RollingTranscript.delta() replaces the whole open line)
  isFinal: boolean;       // true only on the transcription session's "completed" event
  sequence: number;       // monotonic per speakerId, starting at 0, assigned client-side
  providerEventKey: string; // `livekit:{speakerId}:{sequence}` — fixed at creation,
                             // never regenerated on retry
  atMs: number;           // performance.now() - (performance.now() captured right after
                           // POST /session resolves) — see "Unverified" below, this is an
                           // approximation of the server's session clock, not a sync
}
```

`role` is never `"unknown"` in this app: per the task's own instruction, the browser
operator is always `subject` and every other room participant is always `counterparty`.
(`shared/src/speaker.ts` still allows `"unknown"` as a fallback for a transport that
genuinely cannot tell — this one always can, because there is no ambiguity between "the
local participant" and "everyone else" in a two/three-person demo room.)

Whitespace-only finals are discarded before POSTing (matches the rule
`add-live-transcription` applies to every other transport).

## The gateway endpoint this app POSTs to — precise, for whoever implements it

```
POST {gatewayUrl}/session/{sessionId}/segments
Authorization: Bearer {sessionToken}     (sent only if present — see below)
Content-Type: application/json

{ "segments": TranscriptSegment[] }

-> 202 { "accepted": <number> }
```

This is **not implemented server-side today** — `server/src/gateway.ts` currently has
only `POST /session` and `WS /session/:id`. This app is built exactly to the contract
`openspec/changes/add-browser-livekit-rung/specs/browser-call-rung/spec.md` already
specs, so implementing it should need no renegotiation:

1. **A `BrowserTranscriptSource` (`kind: 'livekit'`)** implementing
   `shared/src/transcript-source.ts`'s `TranscriptSource` interface — same shape every
   other source (`server/src/replay-source.ts` is the reference implementation) already
   satisfies. Its `onSegment`/`onSpeaker`/`onEnded` are driven by whatever this route
   receives, not by a timer.
2. **The route itself**, wired into `server/src/gateway.ts` next to the existing
   `SESSION_PATH` regex, forwarding each segment in the POST body into that session's
   `BrowserTranscriptSource`.
3. **Session-bound authorization — the one genuinely new trust boundary this path
   introduces** (every other `TranscriptSource` either runs in-process or is a
   provider-signed webhook; this is the first one fed by code the gateway does not
   control). The spec requires, in order:
   - No `Authorization` header at all -> refuse before ever looking up the session id.
   - A credential that does not authorize `sessionId` -> refuse, write nothing, and say
     so in the response (not a silent 200).
   - A valid credential for `sessionId` -> accept.

   **This app already sends `Authorization: Bearer {token}` whenever
   `POST /session`'s response includes a `token` field** (see
   `src/gateway/session-client.ts`) — today's response has no such field, so today this
   header is simply absent and every POST would need to be refused per the rule above
   (missing credential). The one thing the gateway side needs to add to make this real:
   have `POST /session` mint and return that credential. No change needed on this side
   once it does.
4. **The OpenAI Realtime ephemeral-secret route** the design doc leaves open
   (`POST /session/:id/realtime-secret` or equivalent). Until it exists, this app's own
   `token-server/server.mjs` stands in — see that file's header for the one-line swap
   once the gateway grows it.

## What is verified and what is not

**Verified in this session:**
- `npx tsc --noEmit` passes.
- `npm run build` passes (`vite build`, single ~575 kB chunk).
- `npm run dev` serves the app; cross-repo imports (`shared/src/*.ts` as types,
  `agent/src/fixtures/bank-scam.ts` as data) resolve correctly through Vite, both as dev
  requests (`/@fs/...`) and in the production bundle.
- The built bundle contains no `OPENAI_API_KEY` and no `sk-`-prefixed string.

**NOT verified — could not be, from here, and nobody should assume otherwise because
nothing threw while writing this:**
- **No live LiveKit room has ever been joined.** `livekit-client`'s API surface
  (`RoomEvent.TrackSubscribed`, `LocalTrackPublished`, `.mediaStreamTrack`, `Room`
  constructor options) is used per its published types and compiles clean, but the
  actual join/publish/subscribe handshake against a real LiveKit Cloud project has not
  run.
- **No real OpenAI Realtime transcription session has been opened from this app.** The
  ported `transcription-session.ts` is unmodified from a version the starter kit already
  runs in production for its own voice page — but this app's own wiring around it
  (`participant-pipeline.ts`'s delta-accumulation, the token-server round trip) has not
  been exercised against a live socket.
- **No audio has ever gone through `track-tap.ts`'s AudioWorklet against a real
  `MediaStreamTrack`.** The worklet logic is a direct adaptation of `stereo-capture.ts`'s
  proven mono path; it has not been run.
- **The gateway ingest route does not exist**, so no segment has ever actually reached a
  `Session` or `RollingTranscript` from this app. Everything past `TranscriptPoster`'s
  `fetch()` call is this document's description of the target contract, not an observed
  round trip.
- **`atMs` is an approximation**, not a synchronized clock — see the field's own comment
  in `participant-pipeline.ts` and the shape table above. `sequence` is exact and is what
  the gateway actually orders by; `atMs` is cosmetic (clock display) until proven
  otherwise.
- **Two-tab / tab-plus-phone room behavior, a late-joining third participant, and a
  participant leaving mid-call** are all implemented (see `livekit/room.ts`'s
  `TrackSubscribed`/`TrackUnsubscribed`/`ParticipantDisconnected` handlers) but none of
  these scenarios has been run against a real room.

**What a human must do to actually prove this works:** run the three processes above, a
real LiveKit Cloud project, a real OpenAI key, two browser tabs (or a tab and the phone)
in the same room, and confirm the level meters move when someone speaks and the
transcript renders their words. Per this project's own house rule: silence looks exactly
like success here, so "nothing threw" is not evidence — watching a level meter move is.
