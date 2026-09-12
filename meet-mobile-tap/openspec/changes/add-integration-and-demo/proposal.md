## Why

Four tracks building against fakes will each be "done" and the system will not work. Every
seam that was a fake is a place where two people made different assumptions, and finding
them all on Saturday morning is how hackathon projects die at the demo.

The fix is to schedule integration rather than arrive at it: three checkpoints where a
vertical slice has to run end to end, each earlier than feels necessary.

The second half of this change is the demo itself, which has its own failure modes. The
product depends on a phone network, a WebRTC service, a tunnel, two model APIs and a device
on conference wifi. Something will fail. The plan is to have a rung to drop to rather than
an explanation to give.

## What Changes

- Three **integration checkpoints**, each a defined vertical slice with a named owner pair,
  that must run end to end before the tracks continue.
- A **fallback ladder**: Twilio → LiveKit → replay, switchable from the app, with the
  current rung visible. Each rung is a complete demo on its own; the ladder only changes how
  real the call is.
- A **pre-flight check** that verifies every external dependency in one command — Twilio
  number and webhook, LiveKit credentials, model access and model name, tunnel URL, gateway
  reachability from the device — and reports what is down rather than failing on the first
  problem.
- A scripted scam call for the demo: the script, who reads it, and the expected detection
  point, so the run is rehearsed and the timing is known rather than hoped for.
- The consent script spoken on the call, because 11 US states require all-party consent and
  saying it on stage is both the legal answer and a good part of the story.
- A run book: order of operations, what to say while waiting for the first assessment, and
  what to do when a rung fails mid-demo.
- CLAUDE.md and README.md updated to describe what was actually built, including the
  reversal of the recorded Twilio decision.

## Capabilities

### New Capabilities
- `demo-harness`: running the whole system in front of an audience without depending on
  every part of it working.

## Impact

- New: a pre-flight script, the demo fixture and script, the run book.
- `mobile/`: transport switching surfaced in the UI (specified in add-mobile-call-shell).
- Docs: CLAUDE.md's Decision and Status sections, README.md's run instructions.
- Depends on: every other change in this plan, to the degree each has landed. The
  checkpoints are designed so this change starts on day one rather than at the end.
