## Scope as of now

This proposal is largely unaffected by the current scope decisions — the risk HUD, live
transcript, consent step, transport selection and degraded states are exactly what "Live
risk HUD on the phone" in the current scope means. Two adjustments:

- `audio.silent` (a server-side RMS-based event) is deferred along with the rest of the
  audio pipeline — see `add-call-session-contracts`' Scope as of now. Its degraded-state
  slot is filled by `transcript.degraded` (already in `shared/src/events.ts`), which
  reports Twilio's transcription callback going quiet or degraded for a leg. The
  client-side per-participant level meter itself (`useTrackVolume`) is unaffected and
  stays exactly as specified — it is local UI, not the deferred server event.
- The post-call summary's "matches the case file" checks and its link to the full case
  file (section 6) are blocked on `add-post-call-case-file`, which is deferred — the
  summary can still be built from session events directly.

The specs below still describe the full original intent — see `tasks.md` for the
per-task tags.

## Why

`mobile/App.tsx` is a call screen: join, mute, and a live level meter per participant. It
proves audio moves, which was the right first thing to build and is not the product. The
product is what the person on the call sees while being defrauded — a risk that rises, a
reason they can check, and something they can do about it.

It also has to be readable by someone mid-conversation who is being pressured. That is a
harder constraint than it sounds and it drives most of the design.

## What Changes

- A gateway WebSocket client with resume-from-sequence, replacing the current model where
  the app holds a baked-in LiveKit token and talks to no server.
- A **consent step before the call connects**, recording consent through the session so it
  lands in the case file. Not a legal footnote: 11 US states require all-party consent.
- A **risk HUD** — band, score, one-line headline — sized to be read at a glance rather
  than studied. `risk-profile.ts` already writes `headline` and `advice` for a phone held
  mid-call; the UI has to honour that.
- Signals as evidence: each with its verbatim quote, so the user can check the claim
  against what they just heard rather than trusting a number.
- A live transcript view, speaker-labelled.
- Transport selection — replay, LiveKit or Twilio — so the demo can switch paths on stage.
- Degraded states made visible: `audio.silent`, transcription down, analysis stalled. The
  level meter stays for exactly the reason CLAUDE.md gives — silence is the expected
  failure and looks identical to success.
- A post-call summary screen linking to the case file.

## Capabilities

### New Capabilities
- `mobile-call-ui`: what the protected user sees and can do on their phone before, during
  and immediately after a monitored call.

## Impact

- `mobile/App.tsx` is restructured into screens; the LiveKit join path and `useTrackVolume`
  meter survive as one transport's implementation rather than as the whole app.
- `mobile/.env` keeps only a gateway URL and session token; `EXPO_PUBLIC_LIVEKIT_TOKEN`
  goes away with add-livekit-call-transport.
- Depends on: add-call-session-contracts. Develops entirely against `npm run dev:fake` —
  no LiveKit account, no Twilio number, no model key.
