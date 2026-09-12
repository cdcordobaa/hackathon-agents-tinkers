# SecureGuIA

Hackathon project — AI Tinkerers **"Agents, Everywhere"**, 12–13 September 2026. Surface: *In the room*.

An agent that listens to a live call from a React Native app and works from the transcript.

## Where this stands

Research is done and the MVP is built. `mobile/` is a working Expo app (Expo 57, RN 0.86) that
joins a LiveKit room, publishes the microphone, and shows a live level meter per participant.
It typechecks and the iOS native project is generated — but it has not yet been run against a
live room, so the join path is unverified.

[`CLAUDE.md`](./CLAUDE.md) is the working document and the thing to read first. It records which
capture paths are genuinely blocked at the OS level and which three actually work in React Native,
so that time is not spent re-discovering dead ends.

The one rule it all reduces to:

> React Native can capture any call your app is a party to. It can never capture a call another
> app owns.

## Working capture paths

| Target | Package | Raw audio | |
|---|---|---|---|
| Your own calls | `@livekit/react-native` | Native track access | **chosen** |
| Zoom meeting | `@zoom/meetingsdk-react-native` | `onMixedAudioRawDataReceived` | later |
| Phone call (PSTN) | `@twilio/voice-react-native-sdk` | Server-side `<Start><Stream>` fork | later |

Capture feeds a PCM16 mono 24 kHz pipeline into a transcription session, and the transcript into
the agent.

**Why LiveKit for the MVP:** a LiveKit room is WebRTC, so two clients in a room *is* a real call —
no phone number, no carrier, no regulatory paperwork for a Colombian DID, and no native module.
Zoom is the only way to be inside an actual Zoom meeting, but its raw-audio callback is not
surfaced in JS and costs a Kotlin + Obj-C bridge.

## Run it

```bash
cd mobile
cp .env.example .env          # fill from LiveKit Cloud → Settings → Keys
npm run token -- --room demo --identity phone
npx expo run:ios              # LiveKit needs a dev build; Expo Go will not work
```

Mint a second token with a different `--identity` and the same `--room` to join from a browser or
another device. Restart Metro with `--clear` after minting — Expo bakes `EXPO_PUBLIC_` vars in at
bundle time.

## Layout

    mobile/
      App.tsx                  call screen — join, mute, live level meter per participant
      index.ts                 imports src/livekit-globals FIRST (ordering is load-bearing)
      src/livekit-globals.ts   registerGlobals(); separate module so it beats import hoisting
      scripts/mint-token.mjs   mints a long-lived token into .env; no token server in the MVP
    CLAUDE.md                  Research notes: what is blocked, what works, and why

## Next step

Run it against a live room and confirm the meter moves. Then the agent: a LiveKit Agent joins the
room server-side, subscribes to the audio tracks, and feeds a transcription session — the RN SDK
gives tracks to render, not raw PCM in JS, so transcription belongs off the phone.

## Ground rules

- Check the level meter before debugging anything else. Silence is the expected failure on mobile
  and it looks exactly like success — `App.tsx` renders `useTrackVolume` per participant for
  precisely this reason.
- The iOS Simulator borrows the Mac's microphone, so it is fine for a first check — but confirm on
  a physical device before the demo.
- Consent is a build requirement, not a footnote: 11 US states require all-party consent.

## Related

Sibling project: `agents-everywhere-starter-kit` — the web `/voice` surface, with a tab+mic stereo
tap feeding an OpenAI transcription session.
