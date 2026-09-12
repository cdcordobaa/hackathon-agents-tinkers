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
