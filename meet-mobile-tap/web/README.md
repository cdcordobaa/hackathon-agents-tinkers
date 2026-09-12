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
        lib/qrcodegen.ts           vendored QR encoder (MIT, Project Nayuki — attribution kept)
        lib/qr-render.ts           renders a session id to an inline SVG QR code, offline
      scripts/mint-token.mjs       LiveKit token minting, same shape as mobile/scripts/
      token-server/server.mjs      stand-in for a gateway-minted OpenAI ephemeral secret

## This browser tab creates the session; the phone joins it by id

The gateway's ingest credential (`token` on `POST /session`'s response) is only ever
handed to whichever caller made that POST — so **this app must be the one that creates
the gateway session**, and the phone (`mobile/`) joins the id this screen shows rather
than creating a second, disconnected one. Before this app existed both sides called
`POST /session` independently and ended up watching two different sessions, with the
phone showing nothing — see the "Session" panel below for how that id gets from this
screen onto the phone.

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
package). `server/src/gateway.ts` implements `POST /session` (mints the id and the
ingest token this app needs), `POST /session/:id/segments`, and `WS /session/:id` — see
"The gateway endpoint this app POSTs to" below for the exact contract this app relies
on. If a future gateway build regresses one of these, that shows up as a clear error in
the Connect panel or in the Session panel's stats, not a silent failure.

**4. The app:**

```bash
npm run dev
```

Open the printed URL. The Connect panel is pre-filled from `.env` (via
`import.meta.env`); every field is also a plain text input, editable and saved to
`localStorage`, so a token or URL can be pasted live at demo time without a rebuild.

## The Session panel — how the phone finds the browser's session

Right below the Connect panel, once "Join room" succeeds, a **Session** panel appears
showing:

- **The gateway session id, large.** Sized to be readable across a room or typed into a
  phone under time pressure, with a **Copy ID** button next to it (one tap, falls back
  to a manual copy if the Clipboard API is unavailable).
- **A QR code** encoding the same id — scan instead of typing a UUID. Generated entirely
  offline (`src/lib/qrcodegen.ts`, vendored, no CDN, no network call), so it renders even
  with the LAN down.
- **The live session state** (`idle` / `awaiting-consent` / `running` / `ending` /
  `ended`), read straight off the gateway WebSocket — not assumed from this tab's own
  actions.
- **The segment-ingest counters** (`posted` / `failed attempts` / `pending`) that were
  already being tracked, now next to the id and state instead of off in a side panel.

That combination is the point: if the phone shows nothing, this panel says whether that
is because the session never reached `running` (consent not yet granted — see below) or
because segments are actually failing to post, rather than leaving "transcription is
broken" as the only visible explanation.

## Demo sequence — two people, two devices

This is the order of operations for a live run, browser-creates / phone-joins:

1. **Operator (laptop):** start the token-server and the gateway (steps 2–3 above), then
   `npm run dev` and open the app. Fill in the Connect panel (LiveKit URL/token/room,
   gateway URL) and click **Join room**. The Session panel appears with the id, its QR
   code, and `session: idle`.
2. **Operator:** hand the phone the id — either read the big id text aloud, tap **Copy
   ID** and send it (Slack/AirDrop/whatever's fastest), or hold the QR code up for the
   phone's camera.
3. **Phone (`mobile/`):** enter or scan that same session id to join the *existing*
   gateway session — **not** a new one. (Separately, and with a *different* identifier,
   the phone also joins the LiveKit **room** by name/token, per `mobile/`'s own setup —
   see the note in this repo's top-level task about not conflating the two ids.)
4. **Operator:** the session state badge moves to `awaiting-consent`. Say the consent
   line out loud (11 US states require all-party consent — see the repo's `CLAUDE.md`),
   then click **Grant consent** in the browser. State moves to `running` — this is the
   operator's own signal that the phone's view should now start filling in.
5. **Either person plays "Caller"** and reads the **Script pane** on screen (the exact
   `agent/src/fixtures/bank-scam.ts` pretext the eval fixtures use), the other plays
   "You" and says nothing scripted. The demo lands at a known moment (the OTP ask, at the
   very end) instead of improvising.
6. **Operator:** watch the Session panel's `posted` counter climb as speech happens, and
   watch a participant's level meter move — per this project's house rule, silence looks
   exactly like success, so a still counter or a flat meter is the thing to check first,
   not the phone screen.
7. **Operator:** click **Leave** when done — this ends the gateway session so the phone
   is not left listening to a session that will never move again.

Any of the following also work for "two clients in a LiveKit room" if a phone is not
available for a rehearsal: two browser tabs, each with a token minted for the same
`--room` and a different `--identity`.

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

## The gateway endpoint this app POSTs to

```
POST {gatewayUrl}/session/{sessionId}/segments
Authorization: Bearer {sessionToken}
Content-Type: application/json

{ "segments": TranscriptSegment[] }

-> 202 { "accepted": <number> } | 400 | 401 | 403 | 409 | 429
```

**Implemented server-side** (`server/src/gateway.ts`, `server/src/browser-source.ts`) —
`POST /session` mints and returns the ingest `token` unconditionally on every create call
(see that file's own header), and this app sends it on every `/segments` POST
(`src/gateway/transcript-poster.ts`). Session-bound authorization is enforced in the
order the spec requires: no `Authorization` header -> refused before the session id is
even looked up; a credential that does not authorize `sessionId` -> refused, nothing
written; a valid credential -> accepted. Dedup is by `providerEventKey`, ordering is by
`sequence` — both per shared/src/transcript-source.ts, not renegotiated here.

Still standing open on the gateway side, unrelated to this app's own task: **the OpenAI
Realtime ephemeral-secret route** the design doc leaves open (`POST
/session/:id/realtime-secret` or equivalent). Until it exists, this app's own
`token-server/server.mjs` stands in — see that file's header for the one-line swap once
the gateway grows it.

## What is verified and what is not

**Verified in this session:**
- `npx tsc --noEmit` passes.
- `npm run build` passes (`vite build`, single ~589 kB chunk).
- `npm run dev` serves the app; cross-repo imports (`shared/src/*.ts` as types,
  `agent/src/fixtures/bank-scam.ts` as data) resolve correctly through Vite, both as dev
  requests (`/@fs/...`) and in the production bundle.
- The built bundle contains no `OPENAI_API_KEY` and no `sk-`-prefixed string.
- `npm run preview` serves the built page and the Session panel's markup
  (`session-id-value`, `session-qr`, the Copy ID button) is present in the response.
- `qrcodegen.ts`'s vendored encoder was exercised directly (bundled standalone with
  esbuild, run under `node`, no browser): `QrCode.encodeText()` on a 36-character UUID at
  `Ecc.MEDIUM` returns a 29×29 module grid with a plausible dark/light module ratio — the
  encoder itself runs and produces QR-shaped output.

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
- **No segment POSTed by this app has ever actually reached a running gateway `Session`
  in this session's testing.** The gateway ingest route exists (confirmed by reading
  `server/src/gateway.ts` and `browser-source.ts`) and the two sides agree on the
  contract, but no end-to-end POST from this app against a live gateway has been run
  here.
- **No phone has ever scanned the QR code or joined a session by the id this screen
  shows.** The QR encodes exactly the same string as the text next to it (same
  `showSessionId()` call site — see `main.ts`), but a real camera scan, and a real
  `mobile/`-side "join by id" flow, are both outside this app's boundary and unverified
  from here. `mobile/` is being changed concurrently, by a different agent, to add that
  join — check its own status before assuming it exists.
- **Copy-to-clipboard has not been exercised in a real browser.** `navigator.clipboard
  .writeText` with a `document.execCommand("copy")` fallback compiles and is the standard
  pattern, but has not been clicked.
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
