## 1. Stand up `web/`

- [ ] 1.1 Scaffold a standalone Vite app at `web/` with `livekit-client` as a dependency;
      verify it has its own `package.json` and builds with no reference into `mobile/`'s
      Expo toolchain
- [ ] 1.2 Join a LiveKit room from the browser using a token fetched from the gateway (or
      a hardcoded dev token while the gateway does not exist yet); verify two browser
      tabs (or a tab and the phone) can see each other as participants
- [ ] 1.3 Render each remote participant's audio so a person can confirm the call works
      before any transcription is wired; verify by listening

## 2. Port the listening session and PCM extraction

- [ ] 2.1 Port `transcription-session.ts` from
      `../agents-everywhere-starter-kit/apps/web/src/lib/` into `web/src/lib/`; verify it
      still has no dependency beyond a `WebSocket` and typechecks
- [ ] 2.2 Retain the MIT attribution comment naming its origin; verify the header is
      present in the ported file
- [ ] 2.3 Adapt `stereo-capture.ts`'s AudioWorklet into a mono single-track PCM16
      extractor (no stereo merge — there is nothing to merge here); verify a synthetic
      tone through one LiveKit track produces a nonzero PCM16 buffer at the browser's
      actual `AudioContext` sample rate
- [ ] 2.4 Retain the MIT attribution for the adapted worklet; verify the header names its
      origin as an adaptation, not a verbatim copy

## 3. One transcription session per remote participant

- [ ] 3.1 On each remote participant's audio track, open an `AudioContext` tap and a
      dedicated `openTranscriptionSession`; verify with two speaking participants that
      two independent sessions exist and neither receives the other's audio
- [ ] 3.2 On a participant joining after the app is already running, open a session for
      them; verify with a participant that joins and speaks after a 10s delay
- [ ] 3.3 On a participant leaving, close their session and stop feeding it audio; verify
      no further segments are produced and no error is thrown after departure

## 4. Segments out

- [ ] 4.1 Map each `delta`/`completed` transcription event to a `TranscriptSegment`
      (shared/src/transcript-source.ts): `speakerId` from the LiveKit participant
      identity, `isFinal` from the event type, monotonic `sequence` per speaker, a unique
      `providerEventKey` per turn, `atMs` from session start; verify with a unit test
      that asserts the mapped shape against the `shared` type
- [ ] 4.2 Assign `role` from whatever the app can determine (or `unknown` if it cannot);
      verify a segment for an unrecognised participant carries `role: "unknown"`, never a
      guess
- [ ] 4.3 POST each segment to the gateway's ingest route, carrying the session
      credential; verify against a stub server first (this task's own fixture), then
      against the real gateway once `server/` releases the route (see group 6)
- [ ] 4.4 Discard whitespace-only finals before POSTing, matching the rule
      `add-live-transcription` already applies; verify with a unit test

## 5. Failure that looks like success

- [ ] 5.1 Detect a transcription WebSocket close that is not a clean local teardown;
      verify by forcing a socket close mid-session and asserting a degraded signal is
      raised for that speaker
- [ ] 5.2 Verify a present-but-silent participant produces no degraded signal — the false
      positive that would make this indistinguishable from a real failure
- [ ] 5.3 Surface connection state (room joined, per-participant transcription up/down)
      somewhere visible in `web/` itself, independent of the phone HUD, so a demo
      operator can see what's wrong without needing the mobile app running

## 6. The one gateway dependency (blocked on server/ existing)

- [ ] 6.1 Implement `BrowserTranscriptSource` (`kind: 'livekit'`) conforming to the
      `TranscriptSource` interface in `shared/src/transcript-source.ts`; verify it
      passes the same conformance suite every other `TranscriptSource` passes
- [ ] 6.2 Implement the ingest route and bind it to session authorization: reject a
      segment whose credential does not authorise the named session id, and reject a
      segment with no credential; verify both rejection paths with tests before wiring
      any success path
- [ ] 6.3 Verify an authorised segment for the correct session is accepted and reaches
      `RollingTranscript` unchanged in shape
- [ ] 6.4 Mint the transcription-scoped Realtime credential the browser app requests in
      task 2; verify the minted credential cannot be used to open a non-transcription
      Realtime session (a spoken-reply session is refused or produces no audio)

## 7. Prove it end to end

- [ ] 7.1 Run a full two-tab (or tab + phone) demo call through `web/` with no Twilio
      account configured anywhere; verify the phone's HUD shows live transcript turns and
      a moving risk score sourced entirely from this path
- [ ] 7.2 Kill one participant's browser transcription session mid-demo; verify the HUD
      shows the degraded state rather than silently freezing
- [ ] 7.3 Attempt to POST a fabricated segment for a session the posting browser was not
      issued a credential for; verify it is refused and does not appear in that session's
      transcript
