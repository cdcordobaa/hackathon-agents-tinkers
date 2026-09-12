# Call audio capture on mobile — full React Native

Hackathon: AI Tinkerers "Agents, Everywhere", 12–13 September 2026. Surface: **In the room**.
Sibling: `../agents-everywhere-starter-kit` (web `/voice` has a tab+mic stereo tap → OpenAI transcription session).

Researched 12 September 2026. This file was rewritten after the first pass got it wrong —
see "Correction" at the bottom.

## The one rule that explains everything

**React Native can capture any call your app is a party to. It can never capture a call
another app owns.**

Every dead end below is the second case; every working path is the first. The question is never
"which library reads Zoom's audio" — it is "how does my app become a participant."

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

## What works — all three, in React Native

| Target | Package | Raw audio | Main cost |
|---|---|---|---|
| **Zoom meeting** | `@zoom/meetingsdk-react-native` 6.7.2 | `onMixedAudioRawDataReceived` | Native module work + host permission |
| **Phone call (PSTN)** | `@twilio/voice-react-native-sdk` 2.x | Server-side fork | Needs a Twilio number |
| **Your own calls** | `@livekit/react-native` | Native track access | Not Meet or Zoom |

**Zoom — join the real meeting.** The official RN wrapper joins a genuine Zoom meeting with
`joinMeeting({ userName, meetingNumber, password, userType })`. Raw audio arrives at
`onMixedAudioRawDataReceived` on both iOS and Android; the entitlement that used to gate this is
gone. Two real costs: the host must grant recording/live-streaming permission in-meeting or you
get `rc=12 NO_PERMISSION`, and the JS layer does not surface the raw-audio callback — you extend
the native module (Kotlin + Obj-C/Swift) to bridge it up. Also note the wrapper does not reliably
emit meeting-status events, and the Gradle version must match the npm version *exactly* or
`NativeModules.RNZoomSDK` is undefined and joins fail silently.

**Phone call — be the softphone.** Twilio Voice RN SDK 2.x supports Expo out of the box and makes
the app a real endpoint on a real number: it places and receives actual PSTN calls. Do **not**
try to grab the mic in JS — that is the open ask in twilio-voice-react-native-app#180 and it is
not what the SDK is for. Twilio already carries the media, so fork it server-side with
`<Start><Stream>` to a WebSocket. Unidirectional fork means the humans' call is untouched and
your agent just listens. Audio arrives as base64 μ-law 8 kHz mono, with `inbound`/`outbound`
tracks giving free speaker separation.

**Meet — substitute it.** If the demo needs a meeting and Zoom is not acceptable, use LiveKit:
`@livekit/react-native` gives full track access, and LiveKit SIP + Phone Numbers (GA since 2025)
covers PSTN in the same stack. You are no longer "in a Meet", but you are in a real call with
legitimate audio.

## Pipeline after capture (shared by all three)

Target **PCM16 mono at 24 kHz** — what the OpenAI Realtime transcription session wants.

- Zoom raw audio and LiveKit tracks: resample device-native → 24 kHz.
- Twilio: μ-law 8 kHz → decode to int16 → upsample 3×. Skipping this is silent failure — the
  session accepts the bytes and transcribes noise.
- `../agents-everywhere-starter-kit/apps/web/src/lib/transcription-session.ts` is a plain
  WebSocket client with no DOM dependency and should port to RN nearly unchanged.
- Speaker separation: free from Twilio's two tracks; Zoom's *mixed* callback needs diarization
  (use the per-participant callback instead if the wrapper can reach it).

## Rules for agents working in this folder

- Physical device only. A silent buffer in the simulator proves nothing.
- **Log RMS of the first buffers before debugging anything else.** Given the concurrent-capture
  rule, silence is the expected failure and it looks exactly like success.
- Never claim capture works because the recorder did not throw.
- Consent is a build requirement: 11 US states need all-party consent. On Zoom the host-permission
  prompt is the disclosure; on Twilio, say it on the call.

## Correction

The first version of this file concluded that mobile capture was impossible and steered toward
using the phone as an acoustic room mic. That was right about eavesdropping and wrong about the
whole problem — it missed that Zoom ships a React Native SDK with raw audio access, and that
Twilio makes the phone a real call endpoint. Both are full-RN paths to real call audio. The room
mic is now a fallback, not the plan.

## Status

Research done, folder scaffolded, nothing built. No RN app initialised yet.
Next: pick a target (Zoom or Twilio), `npx create-expo-app`, then a capture spike that prints an
RMS value per buffer before any model is wired in.
