## 1. Checkpoint 1 — audio to a score (end of day one)

- [ ] 1.1 Run replay transport → real transcription → real analyzer → gateway → phone
      display in one session; verify a rising score appears on a device
- [ ] 1.2 Pair the checkpoint across two tracks and record every seam mismatch found;
      verify each is fixed or ticketed before tracks resume
- [ ] 1.3 Verify the event protocol survives a reconnect mid-session with no gap in the
      transcript

## 2. Checkpoint 2 — a real call (mid day two)

- [ ] 2.1 Replace replay with the LiveKit transport in the same slice, on a physical
      device; verify the level meter moves and transcript turns arrive
- [ ] 2.2 Verify silence detection fires when the microphone is muted and clears when
      unmuted — per CLAUDE.md this is the failure that looks like success
- [ ] 2.3 Confirm on a physical device, not the Simulator, which borrows the Mac's
      microphone and hides device-level capture problems

## 3. Checkpoint 3 — the full product (before rehearsal)

- [ ] 3.1 Run a Twilio call through the whole system with caller reputation, an
      intervention proposed and confirmed, and a case file produced; verify each stage
- [ ] 3.2 Verify the assistant answers a question about the live call during the same
      session
- [ ] 3.3 Record what is not working and decide which rung the demo leads on; verify the
      decision is written down before rehearsal

## 4. Fallback ladder

- [ ] 4.1 Implement ladder ordering and in-app switching without an app restart; verify a
      session starts on each rung in turn
- [ ] 4.2 Display the current rung at all times; verify it is visible during a running
      session
- [ ] 4.3 Verify the bottom rung runs a complete session with the network disabled

## 5. Pre-flight

- [ ] 5.1 Implement a check covering Twilio number and webhook, LiveKit credentials, model
      access and model name, tunnel URL, and gateway reachability; verify it reports every
      dependency in one run with several deliberately broken
- [ ] 5.2 Verify the configured analysis model is confirmed available to the account, not
      merely that a key is set
- [ ] 5.3 Run the check from the device on the venue network; verify gateway reachability
      there and record the hotspot fallback

## 6. Demo script and run book

- [ ] 6.1 Write the scripted scam call and run it through the eval harness; verify the
      expected detection turn is measured and consistent across runs
- [ ] 6.2 Write the consent script spoken on the call; verify a live rehearsal records
      consent in the session
- [ ] 6.3 Write the run book: order of operations, what to say while the first assessment
      is computing, and what to do when a rung fails mid-demo
- [ ] 6.4 Rehearse the full run end to end at least once with the real hardware; verify
      timing and record the total runtime

## 7. Documentation

- [ ] 7.1 Rewrite CLAUDE.md's Decision section to record both transports behind one adapter
      and the reversal of the Twilio rejection, with its date and reason; verify it is
      written only after a real Twilio call has reached the pipeline
- [ ] 7.2 Update CLAUDE.md's Status section so every unverified path is marked unverified;
      verify no claim in the document is untested
- [ ] 7.3 Update README.md's run instructions for the gateway, the token endpoint and the
      ladder; verify a teammate can bring the system up from the docs alone
