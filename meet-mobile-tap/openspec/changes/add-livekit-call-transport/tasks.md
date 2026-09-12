## 1. Prove the unverified path first

- [ ] 1.1 Create a LiveKit Cloud project and fill `mobile/.env`; verify `npm run token`
      succeeds and writes both `EXPO_PUBLIC_` vars
- [ ] 1.2 Run `npx expo run:ios` on a device and join the room; verify the local level
      meter moves — per CLAUDE.md, a bar stuck at zero is the expected failure and is
      indistinguishable from success
- [ ] 1.3 Join from a browser with a second identity in the same room; verify both meters
      move on both ends, then record the result in CLAUDE.md's Status section

## 2. Server-side audio

- [ ] 2.1 Add the LiveKit server SDK and an agent worker that joins a room by name;
      verify the worker appears as a participant in the LiveKit dashboard
- [ ] 2.2 Subscribe to remote audio tracks and log per-track RMS; verify a non-zero RMS
      is logged while someone speaks and zero while nobody does
- [ ] 2.3 Convert subscribed audio to PCM16 mono 24 kHz; verify a recorded sample plays
      back intelligibly and the format assertion in the conformance suite passes

## 3. LiveKitTransport

- [ ] 3.1 Implement `LiveKitTransport` against `CallTransport`; verify the shared
      conformance suite passes
- [ ] 3.2 Map participants to speaker ids and roles from the issued identity; verify a
      test covers subject, counterparty, and a late joiner
- [ ] 3.3 Declare `canSpeak: true` / `canHangup: false` and implement speaking by
      publishing a track; verify a spoken phrase is audible to a second participant
- [ ] 3.4 Implement stall detection distinct from silence: no packets for the timeout is
      a transport error, not silent frames; verify by killing the room mid-session

## 4. Token endpoint

- [ ] 4.1 Add `POST /session/token` minting a room-scoped, session-lifetime token; verify
      a token for an ended session is refused
- [ ] 4.2 Switch `mobile/App.tsx` to fetch the token at join time; verify the app joins
      with no `EXPO_PUBLIC_LIVEKIT_TOKEN` set and no Metro `--clear` restart needed
- [ ] 4.3 Grep the built bundle for the API secret and for a pre-minted token; verify
      neither appears
- [ ] 4.4 Update the "How to run" sections of CLAUDE.md and README.md; verify a teammate
      can bring the path up from the docs alone

## 5. End-to-end proof

- [ ] 5.1 Run a full session on the LiveKit transport with the fake analyzer; verify
      transcript turns arrive on the gateway WebSocket
- [ ] 5.2 Confirm on a physical device, not only the iOS Simulator — the Simulator
      borrows the Mac's microphone and hides device-level capture problems
