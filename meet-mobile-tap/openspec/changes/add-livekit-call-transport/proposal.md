## Scope as of now

LiveKit is confirmed **IN** scope, but only as a call-only rung: `shared/src/transcript-source.ts`
(already on disk) declares `kind: 'livekit'` in the `TranscriptSourceKind` union "for
completeness" but states plainly it "has no implementation in this scope — LiveKit is
call-only and emits no transcript." Detection in the current build runs only on the
Twilio real-time-transcription path.

**Still in scope:** joining a LiveKit room from the phone, the per-participant level
meter (proves audio moves — this is also the demo's visible fallback rung), and the
token endpoint on the gateway (replacing the baked-in `EXPO_PUBLIC_LIVEKIT_TOKEN`, which
is a security-hygiene fix independent of whether transcription runs over this path).

**[DEFERRED — no transcript source over LiveKit in this scope]** The server-side LiveKit
agent worker that subscribes to remote audio tracks and emits normalised `AudioFrame`s,
`LiveKitTransport` as an implementation of `CallTransport` (which no longer exists — see
`add-call-session-contracts`'s scope note), its capability declarations
(`canSpeak`/`canHangup`), and speaking-by-publishing-a-track. Reviving these is what a
future "live detection over LiveKit" change would need; nothing here blocks it.

The specs below still describe the full original intent (LiveKit as a fully analysed
call path) — see `tasks.md` for the per-task deferral tags.

## Why

A LiveKit room is WebRTC, so two clients in a room *is* a real call — which makes it the
one path that needs no phone number, no carrier, and no Colombian DID paperwork. CLAUDE.md
already records this as the chosen MVP path, and `mobile/` already joins a room and shows
a per-participant level meter. What is missing is the server side: nothing subscribes to
those tracks, so no audio reaches the pipeline.

It is also the demo's safety net. If Twilio misbehaves in front of judges, this is the
rung the fallback ladder drops to.

## What Changes

- A **LiveKit agent worker** that joins the room as a participant, subscribes to every
  remote audio track, and emits normalised `AudioFrame`s — this is the only way to get raw
  PCM, because `@livekit/react-native` gives the device tracks to render, not samples.
- A `LiveKitTransport` implementing `CallTransport` and passing the conformance suite.
- A **token endpoint** on the gateway, replacing `mobile/scripts/mint-token.mjs`. The
  current flow bakes a long-lived token into the bundle via `EXPO_PUBLIC_LIVEKIT_TOKEN`
  and requires a Metro restart with `--clear` after every mint. **BREAKING** for the
  existing run instructions in CLAUDE.md and README.md.
- Speaker role resolution: the room identity the gateway minted for the phone is the
  `subject`; every other participant is `counterparty`.
- Capability declaration: `canSpeak: true` (publish a track into the room),
  `canHangup: false` (removing a participant is not ending a PSTN call).
- Proof against a live room, including the level-meter check CLAUDE.md insists on — the
  app has never connected to a real LiveKit room, so nothing about this path is verified.

## Capabilities

### Modified Capabilities
- `call-transport`: adds the requirements specific to the WebRTC path — server-side track
  subscription, token issuance, and participant-to-role mapping.

## Impact

- New: `server/src/transports/livekit.ts`, a LiveKit agent entrypoint, `POST /session/token`.
- `mobile/`: `App.tsx` fetches a token from the gateway instead of reading
  `EXPO_PUBLIC_LIVEKIT_TOKEN`; `scripts/mint-token.mjs` is retained only as a debug tool.
- Docs: the "How to run" sections of CLAUDE.md and README.md change.
- Requires a LiveKit Cloud account and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` on the
  gateway — never on the device.
- Depends on: add-call-session-contracts.
