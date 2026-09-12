## 1. Make a real call to a real model

- [ ] 1.1 List the models the account actually has and set `ANALYSIS_MODEL` to one; verify
      a single structured-output call returns a valid profile — the default `gpt-5-mini`
      has never been exercised
- [ ] 1.2 Run `npm run replay` against the real model end to end; verify a profile is
      produced on every pass and the JSON validates against `RISK_PROFILE_SCHEMA`
- [ ] 1.3 Fix whatever the stub client was hiding (schema rejection, refusals, truncation);
      verify the existing 17 unit tests still pass unchanged

## 2. Fixture set

- [ ] 2.1 Write an OTP-extraction fixture and a tech-support pretext fixture with expected
      risk bands and a labelled decisive turn; verify each loads and replays
- [ ] 2.2 Write an authority/urgency pressure fixture; verify it replays
- [ ] 2.3 Write two benign controls — a real customer-service call about an account, and a
      family call about money — authored by someone other than whoever tunes the prompt;
      verify both replay
- [ ] 2.4 Write two fixtures containing disfluency and plausible transcription errors;
      verify the analyzer does not build a signal on a single odd word
- [ ] 2.5 Write prompt-injection fixtures where a speaker instructs the analyzer to lower
      the score; verify they replay
- [ ] 2.6 Split the set: three fixtures for tuning, the rest held back until a candidate
      prompt is frozen; verify the split is recorded in the eval README

## 3. Evaluation harness

- [ ] 3.1 Implement `npm run eval` running every fixture and reporting per-fixture outcome
      plus aggregate; verify it completes in under a minute on cached runs
- [ ] 3.2 Record turns-to-detection per fraud fixture and fail any that detects only after
      its decisive turn; verify with a deliberately late-detecting stub
- [ ] 3.3 Assert every signal quote is a verbatim substring of the rendered transcript;
      verify with a stub that fabricates a quote and confirm the run fails
- [ ] 3.4 Fail the run if any benign control leaves the lowest risk bands; verify with a
      stub that over-flags
- [ ] 3.5 Assert prompt-injection fixtures do not lower the score; verify all injection
      fixtures pass
- [ ] 3.6 Cache runs by fixture, prompt hash and model; verify an unchanged prompt
      re-verifies with no model calls

## 4. Measurement and tuning

- [ ] 4.1 Report per-pass latency and overlap-induced dropped passes; verify the numbers
      appear in the eval output
- [ ] 4.2 Choose the analysis interval and transcript budget from the measured latency
      rather than the current defaults; verify the chosen values are recorded in design.md
- [ ] 4.3 Tune the prompt in `risk-profile.ts` on the tuning split only, editing type and
      JSON schema together; verify each candidate improves the tuning split without
      regressing the benign controls
- [ ] 4.4 Freeze a candidate, then run the held-back split once; verify the result is
      recorded honestly whether or not it is worse than the tuning split
