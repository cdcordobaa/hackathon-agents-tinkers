# SecureGuIA

Hackathon project — AI Tinkerers **"Agents, Everywhere"**, 12–13 September 2026. Surface: *In the room*.

An agent that listens to a live call from a React Native app and works from the transcript.

## Where this stands

Research is done. `mobile/` is a bare `create-expo-app` scaffold (Expo 57, RN 0.86) — no capture
code written yet.

[`CLAUDE.md`](./CLAUDE.md) is the working document and the thing to read first. It records which
capture paths are genuinely blocked at the OS level and which three actually work in React Native,
so that time is not spent re-discovering dead ends.

The one rule it all reduces to:

> React Native can capture any call your app is a party to. It can never capture a call another
> app owns.

## Working capture paths

| Target | Package | Raw audio |
|---|---|---|
| Zoom meeting | `@zoom/meetingsdk-react-native` | `onMixedAudioRawDataReceived` |
| Phone call (PSTN) | `@twilio/voice-react-native-sdk` | Server-side `<Start><Stream>` fork |
| Your own calls | `@livekit/react-native` | Native track access |

Capture feeds a PCM16 mono 24 kHz pipeline into a transcription session, and the transcript into
the agent.

## Layout

    mobile/      Expo app (Expo 57, React Native 0.86) — the capture surface
    CLAUDE.md    Research notes: what is blocked, what works, and why

## Next step

Pick a target (Zoom or Twilio), then a capture spike in `mobile/` that prints an RMS value per
buffer before any model is wired in.

## Ground rules

- Physical device only — a silent buffer in the simulator proves nothing.
- Log RMS of the first buffers before debugging anything else. Silence is the expected failure
  and it looks exactly like success.
- Consent is a build requirement, not a footnote: 11 US states require all-party consent.

## Related

Sibling project: `agents-everywhere-starter-kit` — the web `/voice` surface, with a tab+mic stereo
tap feeding an OpenAI transcription session.
