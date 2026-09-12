## 1. Port the listening session

- [ ] 1.1 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Port `transcription-session.ts` from
      `../agents-everywhere-starter-kit/apps/web/src/lib/` into `server/`; verify it has
      no DOM dependency left and typechecks under Node
- [ ] 1.2 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Confirm the session is listen-only — it transcribes and never generates a reply;
      verify by asserting no response audio or text is ever produced
- [ ] 1.3 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Retain the MIT attribution for the ported file; verify the header names its origin

## 2. Feed it real frames

- [ ] 2.1 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Accept `AudioFrame` (PCM16 mono 24 kHz) and forward to the streaming API; verify
      a fixture WAV transcribes to the expected text
- [ ] 2.2 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Open one session per speaker on the transport's participant events; verify a
      two-speaker replay produces correctly labelled turns
- [ ] 2.3 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Close every session on session end; verify no socket remains open after `ended`

## 3. Into the rolling transcript

- [ ] 3.1 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Route in-progress results to `transcript.delta` and finals to `transcript.final`;
      verify a test with a repeatedly revised partial yields the final text exactly once
- [ ] 3.2 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Discard whitespace-only finals; verify a unit test covers it
- [ ] 3.3 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Emit `transcript.turn` on the session stream for each final; verify a subscriber
      sees the turn before the next analysis pass that includes it

## 4. Failure that looks like success

- [ ] 4.1 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Implement reconnection with backoff; verify by killing the socket mid-call and
      asserting turns resume
- [ ] 4.2 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Emit a degraded state naming the speaker on drop, stall, and audio-without-turns;
      verify all three branches with tests
- [ ] 4.3 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Verify a present-but-silent speaker produces no degraded state — the false
      positive that would make the signal useless

## 5. Measurement

- [ ] 5.1 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Record end-of-speech → final-available latency per turn; verify a completed
      session reports the distribution
- [ ] 5.2 [DEFERRED - superseded by Twilio Real-Time Transcription / no in-process STT in current scope; see proposal.md Scope as of now] Run the full fixture and record median and worst-case latency in the change's
      design notes; verify the number is small enough for a 6s analysis interval to be
      worth running
