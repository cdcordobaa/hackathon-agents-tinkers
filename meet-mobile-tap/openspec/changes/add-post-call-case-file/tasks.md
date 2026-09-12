## 1. Assembly

- [ ] 1.1 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Build the case file by folding the session event stream; verify a replayed event
      log produces a byte-identical case file twice
- [ ] 1.2 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Assert no field is sourced outside the event stream; verify by folding a log with
      a category of event removed and confirming the corresponding section is absent rather
      than filled from elsewhere
- [ ] 1.3 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Produce a case file for a session that ended early or errored, marked incomplete
      with its reason; verify against a session killed mid-call

## 2. Contents

- [ ] 2.1 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Record every assessment in order with band, score, headline and change summary;
      verify a rising-then-falling fixture shows both movements
- [ ] 2.2 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Preserve each signal's quote, speaker and offset; verify each quote appears in the
      transcript at the recorded offset
- [ ] 2.3 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Include consent with timestamp and method; verify a test asserts it precedes the
      first transcript turn
- [ ] 2.4 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Include caller reputation with its unknown and unavailable states intact; verify
      an unknown result is never rendered as clean
- [ ] 2.5 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Include every intervention with decision and outcome; verify declined and expired
      proposals appear, and that the section matches the intervention audit exactly

## 3. Export

- [ ] 3.1 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Implement the structured export; verify it round-trips into a case file with no
      loss
- [ ] 3.2 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Implement the readable summary; verify a reader who has not seen the structured
      export can tell what happened, what the evidence was, and what was done
- [ ] 3.3 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Link both from the app's post-call summary; verify the link resolves for a
      completed session

## 4. Retention

- [ ] 4.1 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Attach a retention period at creation and surface it in the app; verify it is
      visible on the case file screen
- [ ] 4.2 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Implement deletion removing transcript, assessments and evidence; verify the case
      file is unretrievable afterwards and no orphaned transcript remains
- [ ] 4.3 [DEFERRED - post-call case file deferred; see proposal.md Scope as of now] Verify no call audio is written anywhere during a full session — grep the storage
      path for audio artefacts after a complete run
