## 1. Gateway client

- [ ] 1.1 Implement a session WebSocket client with typed events from `shared/`; verify it
      connects to `npm run dev:fake` and logs a contiguous sequence
- [ ] 1.2 Implement reconnect with resume-from-sequence, and the backlog-unavailable
      branch; verify by killing the gateway mid-session and asserting no gap in the
      transcript after recovery
- [ ] 1.3 Move `mobile/.env` to gateway URL plus session token only; verify the app runs
      with no LiveKit variables set

## 2. Screens

- [ ] 2.1 Restructure `App.tsx` into setup → consent → call → summary; verify each screen
      renders against the fake gateway
- [ ] 2.2 Build the consent screen recording consent through the session, with a decline
      path that ends it; verify a test asserts no session reaches connected without a
      consent record
- [ ] 2.3 Build transport selection from the gateway's advertised paths; verify an
      unavailable path is not offered

## 3. Risk HUD

- [ ] 3.1 Render band, score and headline, updating on `risk.updated`; verify the display
      changes within one interval on the fake analyzer's rising score
- [ ] 3.2 Make the band perceptible without reading — colour plus shape, not colour alone;
      verify it is distinguishable in greyscale
- [ ] 3.3 Render advice prominently at elevated and above, and not at all when absent;
      verify both cases against fixtures
- [ ] 3.4 Show an explicit "analysis starting" state before the first assessment; verify a
      score of zero is never shown for a call that has not been assessed yet
- [ ] 3.5 Verify the score falls when an assessment lowers it — no latching at the maximum

## 4. Evidence and transcript

- [ ] 4.1 Render signals with type, verbatim quote and rationale; verify against a fixture
      profile carrying several signals
- [ ] 4.2 Render no evidence list when signals are empty; verify the screen implies no
      concern
- [ ] 4.3 Render speaker-labelled final turns in order from `transcript.turn`; verify order
      is preserved across a reconnect

## 5. Degraded states

- [ ] 5.1 Keep a per-participant level meter visible for the whole call; verify it is
      present on every transport, per CLAUDE.md's rule that silence looks like success
- [ ] 5.2 Surface `audio.silent`, transcription-degraded and connection-lost states; verify
      each with a fake gateway that emits them
- [ ] 5.3 Verify no degraded state is shown during a healthy call — a false alarm here
      trains the user to ignore the real one

## 6. Summary

- [ ] 6.1 Build the post-call summary from session events — highest risk, signals,
      interventions; verify it matches the case file for the same session
- [ ] 6.2 Link to the full case file; verify the link resolves for a completed session

## 7. Device check

- [ ] 7.1 Run the whole flow on a physical device against the fake gateway; verify text is
      legible at arm's length and the HUD is readable without interaction
