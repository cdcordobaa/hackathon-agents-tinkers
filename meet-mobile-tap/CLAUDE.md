# Xentinela — call audio capture on mobile, full React Native

Hackathon: AI Tinkerers "Agents, Everywhere", 12–13 September 2026. Surface: **In the room**.
Sibling: `../agents-everywhere-starter-kit` (web `/voice` has a tab+mic stereo tap → OpenAI
transcription session).

An agent that listens to a live call from a React Native app and works from the transcript.

## The one rule that explains everything

**React Native can capture any call your app is a party to. It can never capture a call
another app owns.**

Every dead end below is the second case; every working path is the first. The question is never
"which library reads Zoom's audio" — it is "how does my app become a participant."

## Decision (12 September 2026)

**LiveKit, no phone number.** A LiveKit room is WebRTC, so two clients in a room *is* a real
call. That was the easiest MVP path and it dissolved the open question about using a Colombian
number: numbers only matter for PSTN, and owning a Colombian DID needs regulatory documents.
*Calling* a Colombian number is easy and needs no Colombian number — but the MVP needs neither.

Rejected for the MVP, both still valid later:

- **Zoom** (`@zoom/meetingsdk-react-native`) — the only way to be inside a real Zoom meeting, but
  the raw-audio callback is not surfaced in JS, so it costs a Kotlin + Obj-C native module, and
  the host must grant recording permission live or you get `rc=12`.
- **Twilio** (`@twilio/voice-react-native-sdk`) — real PSTN, fork server-side with
  `<Start><Stream>`. Trial accounts play a "you have a trial account" preamble before connecting,
  which is a bad thing to have happen in front of judges.

## What is genuinely blocked (do not spend time here)

Not RN limitations. OS-level, every framework, no workaround that ships.

- **Another app's VoIP audio.** Android's `AudioPlaybackCaptureConfiguration` admits only
  `USAGE_MEDIA`, `USAGE_GAME`, `USAGE_UNKNOWN`. Meet and Zoom play as
  `USAGE_VOICE_COMMUNICATION`, which is not on the list. Jitsi has an open request for this and
  has not got it. iOS blocks cross-app VoIP audio in the routing layer.
- **Your own mic during someone else's call.** Android's concurrent-capture policy does not stop
  you from starting a capture — it silences you. The recorder reports success and returns zeros.
  This is the most expensive failure mode here because it is indistinguishable from working.
- **The native dialer's existing calls.** Radio-layer isolation on Android, outright block on
  iOS. `CAPTURE_AUDIO_OUTPUT` is signature|privileged — being the default dialer is not enough.
  Play policy banned the Accessibility workaround in 2022.
- **Google Meet, by any means, from the device.** Google does not support third-party Meet
  clients and ships no mobile SDK. The Meet Media API is not a substitute: no SDK at all (you
  write your own WebRTC stack to Google's spec), gated developer preview, every participant must
  be enrolled, admin-gated, and it refuses meetings with encryption or a watermark.

## How to run

```bash
cd mobile
cp .env.example .env          # fill from LiveKit Cloud → Settings → Keys
npm run token -- --room demo --identity phone
npx expo run:ios              # or run:android
```

`npm run token` writes `EXPO_PUBLIC_LIVEKIT_URL` and `EXPO_PUBLIC_LIVEKIT_TOKEN` into `.env` and
leaves the API secret alone. Expo bakes `EXPO_PUBLIC_` vars in at bundle time, so **restart Metro
with `--clear` after minting** or the app keeps the old token.

Mint a second token with a different `--identity`, same `--room`, to join from a browser or a
second device. Two participants in the room is the call.

**LiveKit will not run in Expo Go** — it needs native WebRTC, so a dev build is mandatory.
`ios/` is generated and gitignored; re-run `npx expo prebuild` after changing any config plugin.

## Layout

    mobile/
      App.tsx                    call screen — join, mute, live level meter per participant
      index.ts                   imports src/livekit-globals FIRST (ordering is load-bearing)
      src/livekit-globals.ts     registerGlobals() — see the file for why it is separate
      scripts/mint-token.mjs     mints a long-lived token into .env; no token server in the MVP
    agent/
      src/transcript.ts          rolling transcript; finals only, bounded render
      src/analyzer.ts            progressive analysis loop — skip/no-overlap/bounded
      src/risk-profile.ts        THE SWAPPABLE FILE: schema + prompt
      src/replay.ts              scripted call → full pipeline, no phone, no LiveKit
      src/fixtures/bank-scam.ts  Colombian bank-impersonation pretext for testing
    CLAUDE.md                    this file

## Testing without hardware

`agent/` runs the real pipeline against a scripted call. One model key is all it needs — no
phone, no LiveKit account, no speech-to-text:

```bash
cd agent && npm install
echo 'GEMINI_API_KEY=...' > .env   # free: https://aistudio.google.com/apikey
npm run check                      # one call: key + model + structured output
npm run replay                     # 8x speed
npm run replay -- --speed 1        # real time
npm test                           # 17 unit tests, no key needed
```

Run `check` before `replay`. A bad key, a bad model name and a broken schema all look identical
six seconds into a replay, and `check` separates them in one call.

### Providers

Gemini publishes an OpenAI-compatible endpoint, so switching is a baseURL and a model name;
`model-client.ts` picks it up from whichever key is present. Two places the shim is not a clone,
both handled:

- **`strict: true` on a json_schema is an OpenAI extension.** Gemini ignores or rejects it, so it
  is omitted for Gemini.
- **Free-tier Gemini is single-digit requests per minute.** The 6s default cadence is 10 rpm and
  would spend the call being throttled, so the Gemini default interval is 15s. This is why the
  interval is a per-provider value and not a constant.

Free Gemini is **Flash models only** — Pro left the free tier in April 2026. Note also that free
tier prompts may be used to improve Google products, which is worth a thought before feeding it
real call transcripts.

### Model choice, measured on the bank-scam fixture

| Model | Latency/pass | Behaviour on the fixture |
|---|---|---|
| `gemini-3.5-flash-lite` | ~1.8s | **default.** Straight to HIGH 85, then 95. Finds more signals. |
| `gemini-3.8-flash` | ~3.6s | ELEVATED 60 → HIGH 95. More gradual, better arc to demo. |

Lite is the default because latency decides how many passes actually fire. A pass that takes
longer than the interval means almost every tick collides with a running pass and is dropped — at
3.6s against a 3.75s interval only two passes ran in the whole call. Lite doubles the pass count
for free.

The trade is real though: lite calls it HIGH almost immediately, which is *safer* for a protection
product and *less interesting* to watch. If the demo is the arc, switch to `gemini-3.8-flash`.

**A Claude subscription cannot be used here.** Pro/Max covers the Claude apps and Claude Code, not
API calls from your own process. The Anthropic API is separate, billed per token, keyed from
console.anthropic.com.

Test this before wiring audio. The interesting behaviour — does the score climb as the pretext
develops, does it spike at the OTP request — has nothing to do with microphones, and finding out
should not be gated on a LiveKit account.

## Pipeline after capture

Target **PCM16 mono at 24 kHz** — what the OpenAI Realtime transcription session wants.

`@livekit/react-native` gives tracks to *render*, not raw PCM in JS. So transcription belongs
server-side: a LiveKit Agent joins the room as a participant and subscribes to the audio tracks.
That is the designed path and it keeps the API key off the phone.

`../agents-everywhere-starter-kit/apps/web/src/lib/transcription-session.ts` is a plain WebSocket
client with no DOM dependency and should port to the agent process nearly unchanged.

Speaker separation is free here: each participant is a separate track, so no diarization.

## Progressive analysis — three rules that keep it standing up

"Concatenate every few seconds and send it" is the right instinct and breaks in three specific
ways on a real call. `analyzer.ts` encodes the fixes:

- **Skip if nothing new.** Re-analysing an unchanged transcript costs money and returns the same
  answer. `RollingTranscript.pendingSegments` gates the tick.
- **Never overlap.** A pass takes seconds; on a fixed interval a queue only ever grows. A tick
  that lands while a pass is running is *dropped*, not queued.
- **Bound the prompt.** Unbounded concatenation is fine for ten minutes and fatal for an hour.
  `render({ maxChars })` keeps the head and the tail, because on a call being judged for intent
  the opening pretext matters as much as the last sentence.

Two more that are easy to miss:

- **Only finals go in.** Deltas get revised constantly, and analysing revised text makes the model
  argue with itself between passes.
- **Carry the previous assessment into the prompt.** That is what makes it progressive — the model
  revises and reports what `changed`, instead of recomputing from scratch each pass.

The stable system prompt goes first in the message list so the growing transcript sits behind a
constant prefix, which is the part prompt caching can reuse.

## Rules for agents working in this folder

- **Log RMS / check the level meter before debugging anything else.** Given the concurrent-capture
  rule, silence is the expected failure and it looks exactly like success. `App.tsx` renders
  `useTrackVolume` per participant for exactly this reason — a bar that never leaves zero means
  no audio is arriving, and no amount of staring at connection state will show that.
- Never claim capture works because the recorder did not throw.
- The iOS Simulator uses the Mac's microphone, so it is fine for a first check — but confirm on a
  physical device before the demo.
- Consent is a build requirement: 11 US states need all-party consent. Say it on the call.

## Troubleshooting

- **`expo prebuild` exits 0 while `pod install` failed.** The pod failure is printed as a warning
  and does not set the exit code, so "exit 0" is not evidence the native project is usable. Check
  for `ios/*.xcworkspace` — CocoaPods writes it last, so its absence means the install did not
  finish, whatever the exit code said.
- **`Couldn't determine repo type for URL: https://cdn.cocoapods.org/`** with a complaint about
  `~/.netrc` permission bits: CocoaPods refuses to run while `~/.netrc` is group/world readable.
  `chmod 600 ~/.netrc`, then `cd ios && pod install`. (600 is the correct mode for that file
  anyway — it holds credentials.)
- **`sh: node: command not found` from `pod install`** (or from an Xcode build phase) on a machine
  where node plainly works. `node` here is a *lazy-loading nvm shell function*, not a binary — it
  only materialises after the first interactive call, so `command -v node` returns `node` and any
  non-interactive subshell fails. The Podfile shells out to node on line 1, so it dies immediately.
  Prefix the real directory:

      PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" pod install

  Xcode needs the same treatment — it does not read your shell profile either.
- **`NativeModules` undefined after adding a config plugin.** Re-run `npx expo prebuild`; plugins
  only apply at prebuild time, so a plugin added after the native project exists does nothing.

## Correction

An earlier version of this file concluded mobile capture was impossible and steered toward using
the phone as an acoustic room mic. That was right about eavesdropping and wrong about the whole
problem — it missed that Zoom ships a React Native SDK with raw audio access, and that being a
WebRTC client sidesteps the question entirely. The room mic is a fallback, not the plan.

## Status

**mobile/** — Expo app written and typechecking clean. iOS native project built:
`ios/RoomTap.xcworkspace` exists and the `LiveKitWebRTC` pod is installed (1.3 GB). Info.plist
carries the mic usage string and the audio/voip background modes.

**agent/** — transcript + progressive analyzer written, 17 unit tests passing, typecheck clean.
`npm run replay` exercises the whole loop against a scripted call.

**Unverified, and it matters:**

- The app has **never connected to a live LiveKit room**. Needs a LiveKit Cloud account + `.env`.
- The analyzer has **never made a real model call** — every test uses a stub client. The control
  logic is covered; the prompt, the schema and the model name are not. `ANALYSIS_MODEL` defaults
  to `gpt-5-mini`; set it to whatever the account actually has.
- **Speech-to-text is not wired at all.** `RollingTranscript` is fed by the replay script today.
  Nothing yet connects LiveKit audio tracks to an STT session and into `transcript.final()`.

Next, in order: run the replay with a real key and tune the prompt; then STT into the transcript;
then the LiveKit agent entrypoint; then push profiles back to the phone as room data messages.
