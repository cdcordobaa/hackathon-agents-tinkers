# SecureGuIA — LiveKit call demo

Two people join the same LiveKit room from a browser or the Expo app. A server-side
participant receives their consented audio, transcribes it with Gemini, and publishes
progressive risk assessments. The call screen shows **Call in progress**, elapsed time,
people, audio activity, transcript, evidence, and guidance.

## Show the mid-call screen immediately

```bash
cd meet-mobile-tap/agent
npm ci
npm run dev
```

Open <http://localhost:8787> and choose **Open demo preview**. It opens an evolving
sample already two minutes into a call. The persistent **Demo preview — no live call**
banner identifies simulated audio levels, transcript, and assessments. No credentials,
microphone, or model calls are needed for this route.

## Make a real call

Copy `agent/.env.example` to `agent/.env` and fill in:

| Setting | Where to obtain it | Purpose |
| --- | --- | --- |
| `LIVEKIT_URL` | [LiveKit Cloud](https://cloud.livekit.io), project settings | Room server URL (`wss://…`) |
| `LIVEKIT_API_KEY` | Project → Settings → API keys | Server authentication |
| `LIVEKIT_API_SECRET` | Same API key entry | Signs short-lived room tokens |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Audio transcription and default risk analysis |
| `OPENAI_API_KEY` | Optional existing OpenAI project key | Alternative risk analysis; Gemini is still needed for transcription |

Restart `npm run dev` after configuring keys. The service indicators report whether
keys are configured; connection and provider failures appear separately during the call.
Without model keys, audio calls still work and monitoring reports that analysis is unavailable.

1. Open the browser companion on the computer at <http://localhost:8787>.
2. Choose a room (for example `demo`), name, and role, confirm consent, then join.
3. Join that same room from the phone, or from a second browser tab with another name.
4. Use headphones. Check that both people can hear one another and the audio meters move.
5. Speak for at least 12 seconds. Transcription uses 12-second audio chunks; risk updates
   follow completed transcription and the model interval, so this is not word-by-word captioning.

Use localhost or HTTPS for browser microphone access. A plain HTTP LAN URL can reach
the gateway from the native app, but browsers generally require a secure context for microphones.
Each join gets a 30-minute room-scoped token; provider secrets never enter the app bundle.

### Local LiveKit, without a Cloud account

[LiveKit supports local development](https://docs.livekit.io/transport/self-hosting/local/)
with a public development key pair. On macOS:

```bash
brew install livekit
cd meet-mobile-tap/agent
npm run livekit:local
```

In a second terminal:

```bash
cd meet-mobile-tap/agent
npm run dev:local
```

The supplied `livekit-local.yaml` binds and advertises loopback for both signaling and
media. This connects browsers on this computer to a real room using `devkey` / `secret`.
It still needs a Gemini key for real transcript and risk results. To use a physical phone
with local LiveKit, change both `bind_addresses` and `rtc.node_ip` for your trusted LAN,
then set `LIVEKIT_URL` to the computer's reachable LAN address instead of `127.0.0.1`.
LiveKit Cloud avoids that local networking setup.

## Phone setup

```bash
cd meet-mobile-tap/mobile
npm ci
cp .env.example .env
# Set EXPO_PUBLIC_GATEWAY_URL to the gateway's printed LAN URL for a physical phone.
npx expo run:ios
# Or: npx expo run:android
```

LiveKit requires a native development build; Expo Go does not work. Rebuild after native
configuration changes. The gateway URL is also editable on the join screen. The phone
joins as the person being protected; the browser defaults to the other caller.

The native configuration permits HTTP for this trusted-network demo. Use HTTPS and remove
the Android `plugins/with-demo-cleartext.js` plugin registration before shipping a production app.

## Verification

```bash
cd meet-mobile-tap/agent
npm test
npm run typecheck
npm run build:web
npm run smoke:local  # requires npm run livekit:local; synthetic audio, no models/mic
cd ../mobile
npx tsc --noEmit
npx expo export --platform ios --output-dir /tmp/secureguia-ios-export
npx expo export --platform android --output-dir /tmp/secureguia-android-export
```

The local smoke test joins two real RTC clients through the gateway and verifies
two-way audible PCM and trusted monitor snapshots. It does not test physical microphones,
Cloud networking, or model responses. Test these with real devices and configured keys.

## Scope and layout

- `agent/src/demo-server.ts`: local join gateway and per-room monitor lifecycle.
- `agent/src/livekit-monitor.ts`: PCM capture, transcription queues, risk analysis, snapshots.
- `agent/web/`: browser participant and explicitly simulated presentation mode.
- `mobile/`: Expo participant, in-call HUD, and local last-seen summary.
- `shared/session.ts`: validated snapshot format shared by both clients.
- `CLAUDE.md` and `openspec/`: earlier research and proposed contracts; reconciliation remains pending.

This branch adds a scoped LiveKit demo. It does not implement Twilio/PSTN, capture calls
owned by another app, persist transcripts, reconcile the OpenSpec event log, or claim a
durable final report. The phone's end screen reflects the last snapshot it received.
The gateway is for a trusted local demo: it has no application login and must not be
exposed as a public token service. Empty rooms are reclaimed after a short grace period.
