# SecureGuIA — phased build plan

An anti-fraud agent that sits inside a live call, detects social-engineering in real time,
intervenes mid-call, and produces a case file afterwards.

The specs live in `openspec/changes/`. Each change has a `proposal.md` (why), a delta spec
(what the system must do), usually a `design.md` (how, and what was rejected), and a
`tasks.md` with checkboxes. `npx @fission-ai/openspec validate --changes --strict` checks
them; `/opsx:apply <change>` implements one.

## The shape of it

One blocking change, then four tracks that do not wait on each other, then integration that
is scheduled rather than arrived at.

```
Phase 0        add-call-session-contracts          everything blocks on this
                        │
     ┌──────────────┬───┴────────────┬──────────────────┐
     │              │                │                  │
Phase 1  Track A         Track B          Track C            Track D
      transport       detection         mobile            signals & action
     ─────────────  ──────────────  ────────────────  ──────────────────────
     livekit-call-  live-           mobile-call-      caller-reputation-
       transport      transcription    shell             signals
     twilio-call-   fraud-analysis- copilot-fraud-    fraud-intervention
       transport      evaluation       assistant       post-call-case-file
     │              │                │                  │
     └──────────────┴───┬────────────┴──────────────────┘
                        │
Phase 2/3      add-integration-and-demo
```

## Phase 0 — the only blocking change

**`add-call-session-contracts`** — one owner, everyone reviews, nothing else starts until it
is green.

It buys the parallelism. It defines `CallTransport`, `AudioFrame`, the session state machine
and the client event protocol, and it ships a **fake behind every seam**: `ReplayTransport`,
`FakeTranscriber`, `FakeAnalyzer`, and `npm run dev:fake`. After it lands, every track can
run the whole pipeline with no LiveKit account, no Twilio number, no microphone and no model
key.

**The gate:** transport conformance suite green against replay, `npm run dev:fake` serving a
subscribable session, and `shared/` typechecking from `agent/`, `server/` and `mobile/`.

## Phase 1 — four tracks

| Track | Changes | Develops against | Needs |
|---|---|---|---|
| **A — transport** | `add-livekit-call-transport`, `add-twilio-call-transport` | conformance suite | LiveKit Cloud, paid Twilio number, public tunnel |
| **B — detection** | `add-live-transcription`, `add-fraud-analysis-evaluation` | replay + fixtures | `OPENAI_API_KEY` only — never a microphone |
| **C — mobile** | `add-mobile-call-shell`, `add-copilot-fraud-assistant` | `npm run dev:fake` | a physical device |
| **D — signals & action** | `add-caller-reputation-signals`, `add-fraud-intervention`, `add-post-call-case-file` | fixture providers | Twilio Lookup, Verify, Messaging |

Within a track the changes are ordered. Across tracks they are not.

## Phase 2/3 — integration and demo

**`add-integration-and-demo`** starts on day one, not at the end. Three checkpoints, each a
vertical slice owned by a pair from *different* tracks, because the bugs live between tracks:

1. **End of day one** — audio to a score: replay → real transcription → real analyzer →
   gateway → a rising score on a phone.
2. **Mid day two** — a real call: LiveKit transport in the same slice, on a physical device.
3. **Before rehearsal** — the full product: Twilio, caller reputation, an intervention
   confirmed, a case file, the assistant answering.

## The multiple paths

Three transports behind one interface, which is also the demo's fallback ladder:

| Path | What it is | Fails if |
|---|---|---|
| `twilio` | Real PSTN. `<Start><Stream>` forks the audio server-side. | carrier, tunnel, account |
| `livekit` | WebRTC. Two clients in a room *is* a call. | LiveKit Cloud, wifi |
| `replay` | A scripted call through the real pipeline. | nothing |

Each rung is a complete demo on its own. The ladder only changes how real the call is.

## Decisions this plan reverses or commits to

- **Twilio is back.** CLAUDE.md rejected it for the MVP because trial accounts play a
  preamble before connecting. That reason has not gone away — it is now task 1.1 of
  `add-twilio-call-transport` with a deadline (upgrade the account, verify with a real call
  ≥24h before the demo), and LiveKit stays as the rung below.
- **Audio normalises at the adapter**, to PCM16 mono 24 kHz, with an RMS on every frame.
  Downstream never sees μ-law or Opus. What the narrowband conversion costs in transcription
  accuracy is measured in `add-twilio-call-transport` task 3.3, not assumed.
- **Analysis stays server-side.** `@livekit/react-native` gives tracks to render, not PCM in
  JS. That is also what keeps provider keys off the phone.
- **Propose, then confirm.** Interventions reach the world only through a user decision. One
  bounded exception: a pre-armed call-local warning, because the decisive window in an OTP
  scam is shorter than the time a pressured person takes to read a dialog.
- **The assistant reads the assessment; it does not compute one.** Two things scoring the
  same call would disagree in public.
- **Consent is a state in the session machine**, not a checkbox in the UI, so no track can
  ship a path around it.

## Open risks

- `@copilotkit/react-native` pulls reanimated, gesture-handler and bottom-sheet into an Expo
  57 project already carrying LiveKit's WebRTC pods. Time-boxed spike with a named exit —
  see `add-copilot-fraud-assistant` design.
- The analyzer has never made a real model call; `ANALYSIS_MODEL` defaults to `gpt-5-mini`,
  which the account may not have. First task of `add-fraud-analysis-evaluation`.
- The app has never connected to a live LiveKit room. First task of
  `add-livekit-call-transport`.
- Silence is the expected failure on mobile and is indistinguishable from success. Every
  layer carries an RMS for this reason; see CLAUDE.md.
