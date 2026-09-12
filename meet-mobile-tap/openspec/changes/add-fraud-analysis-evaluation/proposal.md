## Scope as of now

Unaffected by the current scope decisions. This track (assigned to an outside Codex
session per the fixtures+eval track) runs entirely against `agent/`'s replay pipeline and
never needs a microphone, a LiveKit account or a Twilio number — nothing here depends on
how a call reaches the transcript. Proceeds as written; `tasks.md` is unchanged.

## Why

The analyzer has never made a real model call. CLAUDE.md is explicit: every test uses a
stub client, so the control logic is covered and the prompt, the schema and the model name
are not. `ANALYSIS_MODEL` defaults to `gpt-5-mini`, which the account may not even have.

Worse, there is no way to tell whether a prompt change made detection better or worse. On a
one-day build, "it looked right on the bank-scam fixture" is how a prompt gets tuned into
something that flags every polite customer-service call. The scoring behaviour is the
product; it needs a measurement, and the measurement needs to exist before the tuning.

## What Changes

- First real model calls: pick a model the account has, run the existing fixture end to
  end, and fix whatever the stub was hiding — structured-output rejections, schema drift,
  latency.
- A **labelled fixture set** beyond the single bank-impersonation script: an OTP-extraction
  call, a tech-support pretext, an authority/urgency pressure call, and — the one that
  matters most — two benign controls, a real customer-service call and a family call that
  mentions money.
- An **evaluation harness** scoring the analyzer against those fixtures on: does it reach
  the expected risk band, how many turns until it does, does it stay quiet on the benign
  controls, and does it quote real transcript text.
- A prompt-injection suite: fixtures where a speaker instructs the analyzer to lower the
  score or ignore its rules. `risk-profile.ts` already states the rule; nothing tests it.
- A per-pass latency and cost measurement, since the analysis interval, the transcript
  budget and the model choice trade against each other and are currently guesses.
- Whatever prompt and schema changes the evidence justifies, in `risk-profile.ts` — the
  file its own header calls the swappable one.

## Capabilities

### New Capabilities
- `fraud-analysis`: producing a live, progressive, evidence-backed risk assessment of a
  call in progress, and the evaluation that says whether it is any good.

## Impact

- `agent/src/risk-profile.ts`: prompt and possibly schema change. Both travel together, as
  the file's header requires.
- `agent/src/analyzer.ts`: no logic change expected — the three control rules
  (skip-if-nothing-new, never-overlap, bounded-prompt) are already correct. Defaults for
  interval and transcript budget may change on evidence.
- New: `agent/src/fixtures/*`, `agent/src/eval/`.
- Requires `OPENAI_API_KEY` and a model the account actually has.
- Depends on: add-call-session-contracts. Independent of the transports — this track never
  needs a microphone.
