## Context

Four tracks, three of them developing against fakes from add-call-session-contracts. See
proposal.md — Why.

CLAUDE.md's existing rules apply directly to the demo: silence is the expected failure and
looks exactly like success, the iOS Simulator borrows the Mac's microphone so it hides
device problems, and consent is a build requirement.

## Goals / Non-Goals

**Goals**
- Integration failures found on day one, not on demo morning.
- A demo that degrades visibly instead of collapsing.
- A rehearsed run with known timing.

**Non-Goals**
- Production reliability, deployment, or CI.
- Hiding the fallback. If the demo drops a rung, saying so is better than pretending — the
  architecture is the reason it can drop, and that is worth a sentence.

## Decisions

### Three checkpoints, each a vertical slice, each early

**Checkpoint 1 — audio to a score (end of day one).** Replay transport → real
transcription → real analyzer → gateway event → phone displays a rising score. No LiveKit,
no Twilio. This proves the pipeline and the event protocol, which is where the assumption
mismatches between tracks will be.

**Checkpoint 2 — a real call (mid day two).** LiveKit transport replaces replay in the same
slice, on a physical device. This is the first time device audio reaches the pipeline, and
per CLAUDE.md it is the moment silence-that-looks-like-success can bite.

**Checkpoint 3 — the full product (before rehearsal).** Twilio transport, caller reputation,
an intervention proposed and confirmed, a case file produced, the assistant answering.

Each checkpoint is owned by a pair from different tracks, because the bugs live between
tracks and a single owner will fix their own side.

### The ladder is a product feature, not a fallback hack

Three transports behind one interface is the architecture; the ladder is what that
architecture buys. So the rung is visible in the UI and switchable during the demo, and
dropping a rung is a thing the system does rather than a thing that happens to it.

Replay is the bottom rung and it never fails: no network, no account, no microphone. Worst
case, the demo is the full product on a scripted call.

### Pre-flight reports everything, then fails

A check that stops at the first problem means three runs to find three problems. Ten minutes
before a demo, that is the difference between fixing them and not. So every check runs and
the report lists each dependency's state.

### The scam script is written and rehearsed, with a known detection point

An improvised scam call detects at an unpredictable moment, and dead air on stage while
waiting for a score is the worst part of a live AI demo. The script is fixed, run through
the eval harness beforehand, and its expected detection turn is known — so the presenter
knows what to say and for how long.

### Consent is said out loud on the call

It is legally required in 11 US states and it is the right thing regardless. It is also a
good demo beat: it says the product is built by people who thought about the person on the
other end.

## Risks / Trade-offs

- **Checkpoints slip because tracks are behind.** → They are dated, not conditional. A
  checkpoint that runs with a fake still standing in one position is worth more than one
  postponed until everything is ready.
- **Conference wifi.** → Pre-flight includes reaching the gateway from the device on the
  venue network; a phone hotspot is the backup and replay runs locally regardless.
- **The demo depends on two model APIs.** → Eval-harness caching means the scripted call's
  behaviour is known; a rate limit degrades the score's freshness, not the demo.
- **Rehearsal time gets eaten by building.** → The run book and the script are written at
  the same time as the checkpoints, not after them.

## Migration Plan

Not applicable. Documentation updates land last: CLAUDE.md's Decision section is rewritten
only once both transports have carried a real call, so the document never claims a path
that has not run.

## Open Questions

- Inbound or outbound for the Twilio demo. Inbound tells the better story — a scam call
  arrives; outbound is easier to control on stage. Decided at rehearsal.
- Whether the assistant demo happens on the phone or on a second screen, which depends on
  how add-copilot-fraud-assistant's dependency spike resolved.
