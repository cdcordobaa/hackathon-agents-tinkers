## 1. Account, and the reason Twilio was rejected

- [ ] 1.1 Upgrade the Twilio account off trial and buy a voice-capable number; verify by
      placing a real call and confirming no "you have a trial account" preamble plays —
      this is the specific ground on which CLAUDE.md rejected this path
- [ ] 1.2 Do 1.1 at least 24 hours before the demo and record the date in CLAUDE.md;
      verify the call is made from the number that will be used on stage
- [ ] 1.3 Set a spend alert on the account; verify the alert fires on a test threshold

## 2. Webhooks and media stream

- [ ] 2.1 Expose the gateway publicly (tunnel or deploy) and point the number's voice
      webhook at it; verify an inbound call hits the endpoint and is answered
- [ ] 2.2 Return TwiML that forks audio with `<Start><Stream track="both_tracks">`; verify
      the media WebSocket connects and receives payloads
- [ ] 2.3 Decode μ-law and resample 8 kHz → PCM16 mono 24 kHz; verify a captured sample
      plays back intelligibly and the conformance format assertion passes
- [ ] 2.4 Reject a single mixed track with an explicit error; verify by configuring a
      single-track stream and asserting the error rather than merged speakers

## 3. TwilioTransport

- [ ] 3.1 Implement `TwilioTransport` against `CallTransport`; verify the shared
      conformance suite passes
- [ ] 3.2 Map leg direction to `subject` / `counterparty`; verify a two-party call yields
      correctly-roled speaker ids in the transcript
- [ ] 3.3 Measure narrowband cost: transcribe the same speech via the Twilio path and via
      a wideband path, and record word error rate for both; verify the numbers are written
      into design.md's Decisions section
- [ ] 3.4 Implement stall detection separate from silence; verify by pausing the media
      stream mid-call and asserting a transport error
- [ ] 3.5 Implement speak (play into the live call) and hangup; verify both against a real
      call, and verify both are inert after the call has ended

## 4. Mobile leg (time-boxed spike)

- [ ] 4.1 Spike `@twilio/voice-react-native-sdk` in `mobile/`: check for an Expo config
      plugin, run `npx expo prebuild`, and verify `ios/*.xcworkspace` exists — per
      CLAUDE.md, `prebuild` exits 0 even when `pod install` failed, so the exit code is
      not evidence
- [ ] 4.2 Place or receive a call from the app; verify audio is two-way on a physical
      device, not the Simulator
- [ ] 4.3 If the spike exceeds its time box, stop and record the outcome: the transport
      works with the phone dialling in from its native dialer, and the app leg is dropped
      from the demo rather than the transport

## 5. End-to-end proof

- [ ] 5.1 Run a full session on the Twilio transport against a scripted scam call placed
      from a second phone; verify risk profiles arrive on the gateway WebSocket
- [ ] 5.2 Verify the whole path once more on demo-day network conditions, with the tunnel
      URL that will be live on stage
