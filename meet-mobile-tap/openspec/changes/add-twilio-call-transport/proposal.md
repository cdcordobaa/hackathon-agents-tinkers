## Why

Vishing happens on the phone network. A fraud product that can only watch WebRTC rooms is
a demo of a technique; one that watches a real inbound PSTN call is the product. Twilio is
how the app becomes a party to a real call — the Voice React Native SDK makes the phone a
leg, and `<Start><Stream>` forks the audio to the gateway server-side.

This reverses the decision recorded in CLAUDE.md, which rejected Twilio for the MVP because
trial accounts play a "you have a trial account" preamble before connecting. That reason
has not gone away; it is now a scheduled task with a deadline rather than a reason to avoid
the path, and LiveKit stays in place as the fallback.

## What Changes

- **BREAKING (to a recorded decision)**: Twilio moves from "rejected for the MVP, still
  valid later" to a first-class transport alongside LiveKit. CLAUDE.md's Decision section
  is rewritten to say both, behind one adapter.
- A TwiML voice webhook that answers or places a call and forks audio with `<Start><Stream>`.
- A media-stream WebSocket handler decoding Twilio's μ-law 8 kHz payloads and resampling to
  PCM16 mono 24 kHz inside the adapter.
- Dual-track streaming so the caller and the callee arrive as separate speakers — Twilio
  gives leg direction for free, so `subject` / `counterparty` is known here, unlike LiveKit.
- `@twilio/voice-react-native-sdk` in `mobile/`, so the phone is a real call leg. This is a
  native module on top of an Expo project that already carries LiveKit's WebRTC pods, so it
  starts as a time-boxed spike.
- Capability declaration: `canSpeak: true` (`<Say>` / `<Play>` via call update),
  `canHangup: true` (Twilio can end the call).
- A measured answer to whether μ-law 8 kHz upsampled to 24 kHz is good enough for the STT
  path, rather than an assumption either way.

## Capabilities

### Modified Capabilities
- `call-transport`: adds the requirements specific to the PSTN path — media-stream
  ingestion, narrowband conversion, leg-direction roles, and call control.

## Impact

- New: `server/src/transports/twilio.ts`, `POST /twilio/voice` (TwiML), `WS /twilio/stream`.
- `mobile/`: adds `@twilio/voice-react-native-sdk` and its config plugin; requires
  `npx expo prebuild` and another `pod install` — see CLAUDE.md's troubleshooting section
  for the `~/.netrc` and nvm `node: command not found` failures that will bite here.
- Requires a Twilio account with a **paid** (not trial) voice-capable number, plus a
  publicly reachable gateway URL for webhooks and media streams.
- Depends on: add-call-session-contracts.
