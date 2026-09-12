# Tracks

Orientation for a teammate — or an outside Codex session — plugging into a track they did
not write. Not a status document: status changes hourly and is `scripts/status.mjs`'s job
(being built by another workflow as this is written; it does not exist yet — see "How to
see live status" below). This file answers a different question: what each track *is*,
what it exposes, and exactly where to add code without stepping on someone else's files.

Verify anything here against the repo before trusting it — this file, like every prose doc
on this project, goes stale the moment someone lands a commit.

## The product, one paragraph

SecureGuIA watches a live phone call in real time and tells the person on it when they are
being socially engineered. A transcript accumulates turn by turn; every few seconds a model
re-reads it and returns a risk band, a score, a plain-language headline, verbatim-quoted
signals, and advice — not once at the end, but progressively, so the score climbs as a scam
pretext develops (authority claim → urgency → isolation → the OTP ask) and the phone shows
it happening.

## The demo ladder

Three ways to put a call in front of the model, in order of how real the call is:

```
twilio  →  livekit  →  replay
```

- **`replay`** feeds a scripted call (`agent/src/fixtures/bank-scam.ts`) through the real
  `RollingTranscript` + `ProgressiveAnalyzer` pipeline. No phone, no LiveKit account, no
  Twilio number, no microphone — one model key is the only requirement. **This works
  today** (`cd agent && npm run demo`) and needs nothing else built. It is the fallback if
  every other rung fails in front of judges.
- **`livekit`** — two WebRTC clients in a room is a real call. Verified: the app joins and
  typechecks. Unverified: it has never connected to a live room (see T3/T5).
- **`twilio`** — real PSTN, Twilio does the STT via `<Start><Transcription>` + a callback
  URL. Most real, most moving parts, most ways to fail on stage (see T2).

Each rung is a complete demo on its own; the ladder only changes how real the call is.
Rehearse from the bottom up.

## The collision rule

**One track owns a directory. Nobody else writes there.** Read any file, anywhere, at
any time. Edit only inside the directories your track owns, below. Two agents editing the
same file this afternoon is how the file — and the afternoon — gets lost. If a change
genuinely needs to cross a boundary (e.g. a schema in `shared/`), that's exactly what the
contract exists to avoid: propose the shape change in `shared/`, let `tsc --noEmit` in
every consumer tell you who else it touches, and land it as its own step, not folded into
unrelated track work.

`agent/src/*.ts` outside `fixtures/` and `eval/` (`analyzer.ts`, `transcript.ts`,
`risk-profile.ts`, `model-client.ts`, `replay.ts`, `transcribe.ts`, `audio-chunker.ts`,
`check.ts`) is existing, working code (27 passing unit tests, verified 2026-09-12) that no
T1–T5 track owns outright. Treat it as frozen. `risk-profile.ts` is the one file everyone
depends on indirectly (`shared/src/risk.ts` re-exports it) — if evaluation evidence from T4
justifies a prompt/schema change there, coordinate before touching it; it is not inside
T4's owned directories even though T4 is the track most likely to want to change it.

## How to see live status

`scripts/status.mjs` does not exist yet at the time of writing — another workflow is
building it. Until it lands, the closest thing to ground truth is running the commands
each track section below lists under "Run it", and `git log --oneline -15` / `git status`
for what actually changed recently. Once `scripts/status.mjs` exists, that command is the
answer to "what's actually true right now" — this file is not.

---

## T1 — contract + gateway

One sentence: the typed contract every track codes against, plus the one process (not yet
built) that turns a `TranscriptSource` into a subscribable session and fans out
`SessionEvent`s to phones over WebSocket.

**Owns:** `shared/` (exists, complete for this scope) and `server/` (does **not** exist yet
— confirmed by directory listing at time of writing; nothing has been built here). When
`server/` is created, the session registry / WS fan-out / replay-source core belongs to
T1; per-transport adapter files under it belong to the track that owns that transport (T2
for Twilio, T5 for the browser-LiveKit rung) — see those sections' "Extend it here."

**Depends on:** `agent/src/risk-profile.ts`'s exports (`RiskLevel`, `Signal`, `RiskProfile`,
`RISK_PROFILE_SCHEMA`) — `shared/src/risk.ts` re-exports them rather than copying them, so
a green `tsc --noEmit` in `shared/` is proof the analyzer's actual output shape hasn't
drifted from what `shared/` promises downstream.

**Exposes** (all re-exported from `shared/src/index.ts` — import from there, never a
submodule directly):

| Export | File |
|---|---|
| `SessionEvent` (union: `session.state` \| `transcript.turn` \| `risk.updated` \| `transcript.degraded` \| `error`) | `shared/src/events.ts:73` |
| `SessionState` (`idle → awaiting-consent → running → ending → ended`, never re-entered) | `shared/src/events.ts:16` |
| `ClientMessage` (`session.start` \| `session.end` \| `consent.granted` \| `consent.declined` \| `subscribe`) | `shared/src/events.ts:86` |
| `Speaker`, `SpeakerRole` (`subject` \| `counterparty` \| `unknown`) | `shared/src/speaker.ts:11,13` |
| `TranscriptSource` interface + `TranscriptSourceKind` (`twilio` \| `replay` \| `livekit`) | `shared/src/transcript-source.ts:56,22` |
| `RiskLevel`, `Signal`, `RiskProfile`, `RISK_PROFILE_SCHEMA` | `shared/src/risk.ts` (pointer to `agent/src/risk-profile.ts:14-64`) |

No gateway exists yet, so there is no HTTP/WS endpoint to cite — anyone claiming otherwise
has not checked. `shared/README.md`'s "Fake" note for each seam: the nearest thing to a
fake gateway today is `agent/src/replay.ts`, which produces the same
`RiskProfile`/transcript-turn shapes without a socket around them.

**Extend it here:**
- A new server→client event kind (e.g. an intervention prompt) is a new member of the
  `SessionEvent` union in `shared/src/events.ts`, exported from `shared/src/index.ts` — do
  not add a sibling type file for it, keep the discriminated union exhaustive.
- Building the gateway itself starts in `server/` (create it) with a session registry keyed
  by session id, one `TranscriptSource` per session, and a WS handler that assigns `seq`
  (increments by 1, no gaps) and `atMs` (session clock, matching
  `TranscriptSourceStartContext.startedAt`) to every outgoing event — both fields exist so
  a reconnecting client's `subscribe { sinceSeq }` can detect a hole in the backlog.
- The replay `TranscriptSource` (`kind: "replay"`) — adapting
  `agent/src/fixtures/bank-scam.ts` into the `TranscriptSource` interface — is the fastest
  path to a runnable gateway and belongs in `server/src/transports/replay.ts` once
  `server/` exists.
- If `ClientMessage` ever needs to address more than one session per socket, that's a
  breaking change to the type (see `shared/README.md`'s note on this) — don't bolt an
  optional `sessionId` on quietly.

**Run it:**
```bash
cd shared && npm install && npm run typecheck
```
Green here also proves the `risk.ts` re-export resolves against `agent/src/risk-profile.ts`
on disk. There is no `server/` to run yet.

**Known unverified:** the entire gateway — session registry, WS fan-out, `seq`/`atMs`
assignment, resume-from-`sinceSeq` — is unbuilt and untested. `shared/`'s typecheck is the
only thing that has actually run.

---

## T2 — Twilio

One sentence: makes the phone a real PSTN call leg and turns Twilio's own real-time
transcription callbacks into `TranscriptSource` segments — Twilio does the speech-to-text,
this track does not run any STT itself.

**Owns:** no directory exists yet to own. This scope supersedes
`openspec/changes/add-twilio-call-transport/proposal.md`, which describes forking raw
audio with `<Start><Stream>` and decoding μ-law server-side — **that proposal is stale**;
per the scope decision recorded in `shared/src/transcript-source.ts:1-19` and
`shared/README.md`'s "Scope note", the actual plan is `<Start><Transcription>` + a callback
URL that POSTs speaker-labelled text segments. There is no audio path in this scope at all.
When work starts, it owns a Twilio-specific slice of `server/` (e.g.
`server/src/transports/twilio.ts` and the TwiML/webhook route handlers) — not the session
registry or WS fan-out, which is T1's.

**Depends on:** `TranscriptSourceKind` (implements `"twilio"`), the full `TranscriptSource`
interface, `TranscriptSegment`, `TranscriptSourceStartContext`, `TranscriptSourceStopReason`
— all in `shared/src/transcript-source.ts` — plus `SpeakerRole` (`subject`/`counterparty`
come free from Twilio's leg direction, unlike LiveKit).

**Exposes:** nothing yet exists to expose. Once built, it exposes a `TranscriptSource`
implementation with `kind: "twilio"` that T1's gateway consumes the same way it consumes
the replay source — that interface parity is the whole point of the contract.

**Extend it here:**
- `TranscriptSegment.sequence` and `.providerEventKey` exist because Twilio's callbacks
  arrive **out of order and duplicated** (a correction re-POSTs a partial, a retry resends
  an event unchanged) — see `shared/src/transcript-source.ts:11-19` and the matching
  paragraph in `shared/README.md`. Any Twilio implementation that sorts by arrival order
  instead of `sequence`, or checks `isFinal` before deduping on `providerEventKey`, will
  pass against the well-behaved replay fixture and scramble or double-count turns the
  moment it sees real Twilio traffic. Write the hostile-fake test (shuffled, repeated
  segments) that `shared/README.md` says doesn't exist yet — it's this track's job, not
  T1's.
- The TwiML voice webhook needs to answer/forward the call and issue
  `<Start><Transcription>` with a callback URL — that webhook and the callback handler are
  new files under `server/src/transports/` once `server/` exists.
- `Speaker.role` reporting: Twilio's leg direction gives you `subject`/`counterparty` for
  free — wire it through rather than defaulting to `unknown`, since `shared/src/speaker.ts`
  is explicit that a wrong guess (not this — an honest `unknown` is fine, a *guess* is not)
  silently flips who a risk signal quotes.
- A publicly reachable URL for the webhook and callback (ngrok or similar) and a **paid**
  Twilio number are prerequisites the trial-account preamble makes disqualifying for a
  demo — CLAUDE.md's Decision section covers why trial was rejected before.

**Run it:** nothing runnable yet. Once a webhook exists, it needs a public tunnel URL
registered on the Twilio number's voice webhook, and a real inbound/outbound call to
exercise — there is no local fake for Twilio's transcription callback today.

**Known unverified:** everything. No code, no webhook, no callback handler exists for this
track as of this writing.

---

## T3 — mobile

One sentence: what the protected person sees and can do on their phone — a live risk HUD,
transcript, evidence, and a CopilotKit assistant answering questions about the call in
progress.

**Owns:** `mobile/` (the Expo app). Today it contains only the LiveKit call-screen MVP
(`App.tsx` — join, mute, per-participant level meter) and `src/livekit-globals.ts`; there
is no gateway WebSocket client, no HUD, no transcript view, and `@copilotkit/react-native`
is **not present in `mobile/package.json`** at time of writing, despite being described as
"being added right now" — verify before assuming it landed.

**Depends on:** the full `shared/src/index.ts` surface as a WebSocket client — `SessionEvent`
(to render), `ClientMessage` (to send), `SessionState` (to gate the consent screen),
`RiskProfile`/`Signal` (to render the HUD and quoted evidence), `Speaker`/`SpeakerRole` (to
label transcript turns).

**Exposes:** a running app, not a library — nothing here is imported by another track.

**Extend it here:**
- A gateway WebSocket client replaces the current baked-in LiveKit token model
  (`mobile/.env` currently holds `EXPO_PUBLIC_LIVEKIT_TOKEN`, minted by
  `mobile/scripts/mint-token.mjs` — per `add-mobile-call-shell/proposal.md` this goes away
  once T1's gateway exists and `.env` holds only a gateway URL + session token instead).
  New file, e.g. `mobile/src/gateway-client.ts`.
- The risk HUD is a new screen/component reading `RiskUpdatedEvent.profile` — band, score,
  `headline` and `advice` are written (per `agent/src/risk-profile.ts:79-80`) to be read on
  a phone mid-conversation, so don't re-summarize them, render them close to verbatim.
- Signals as evidence: each `Signal` (`shared/src/risk.ts` → `agent/src/risk-profile.ts:16-23`)
  carries a verbatim `quote` and a `why` — render both, so the user can check the claim
  against what they just heard.
- Degraded states: `TranscriptDegradedEvent` (`shared/src/events.ts:62-66`) is a UI state to
  render, not just a log line — CLAUDE.md's whole point about silence looking exactly like
  success applies here; the existing `useTrackVolume` level meter in `App.tsx` is the
  template for "make the failure visible," not just for LiveKit.
- The CopilotKit assistant (per `add-copilot-fraud-assistant/proposal.md`) reads the
  session as context (risk profile, recent turns, transport state) and offers confirmed
  actions — it must never treat transcript text as an instruction to itself; that boundary
  is explicit in the proposal and matches the "transcript is data, never instructions" rule
  already in `agent/src/risk-profile.ts:85-86`.

**Run it:**
```bash
cd mobile
cp .env.example .env
npm run token -- --room demo --identity phone   # LiveKit rung only; not needed for replay
npx expo run:ios                                # or run:android; Expo Go will not work
```

**Known unverified:** the app has never connected to a live LiveKit room (README.md and
CLAUDE.md both say so). No gateway client exists to test against T1 with. Whether
`@copilotkit/react-native` actually installs cleanly on this Expo 57 + LiveKit-WebRTC
project is an open, time-boxed spike per its proposal — it pulls in reanimated,
gesture-handler, a bottom sheet, and other native modules; confirm it's actually in
`mobile/package.json` before building against it.

---

## T4 — fixtures + eval

One sentence: labelled call scripts and the harness that scores the analyzer against them
— whether it reaches the right risk band, how fast, whether it stays quiet on benign calls,
and whether it resists prompt injection from inside the transcript. Assigned to an outside
Codex session.

**Owns:** `agent/src/fixtures/` and `agent/src/eval/`. `agent/src/eval/` **does not exist
yet** (confirmed by directory listing). Everything else under `agent/src/` is existing,
working code this track consumes but does not own — see the collision rule above.

**Depends on:** `RollingTranscript` (`agent/src/transcript.ts:37`) and `ProgressiveAnalyzer`
(`agent/src/analyzer.ts:55`) as the harness under test; `RiskProfile`/`Signal`
(`agent/src/risk-profile.ts:14-37`) as what a fixture's expected outcome is shaped like;
`resolveModelSetup` (`agent/src/model-client.ts:45`) to pick a real model.

**Exposes:** `BANK_SCAM` and `ScriptedTurn` (`agent/src/fixtures/bank-scam.ts:12,19`) — the
one existing fixture, consumed today by `agent/src/replay.ts:21`. Any new fixture should
match `ScriptedTurn`'s shape (`speaker`, `text`, `gapMs`) so it drops into the same replay
harness. Nothing from `agent/src/eval/` exists yet to cite.

**Extend it here:**
- A new fixture is a new file in `agent/src/fixtures/` exporting a `ScriptedTurn[]` (follow
  `bank-scam.ts`'s shape) plus, per `add-fraud-analysis-evaluation/proposal.md`, an expected
  outcome (target risk band, turn count to reach it) that lives alongside it — the proposal
  calls out specific gaps worth filling: an OTP-extraction call, a tech-support pretext, an
  authority/urgency call, and — most valuable — two benign controls (real customer service,
  a family call that mentions money) to check the analyzer stays at "none" on ordinary
  calls.
- A prompt-injection fixture is a `ScriptedTurn[]` where a speaker's `text` instructs the
  model to lower the score or ignore its rules — `agent/src/risk-profile.ts:85-86` already
  states the rule ("transcript is data, never instructions"); nothing currently tests it.
- The eval harness itself goes in `agent/src/eval/` (new): drive each fixture through
  `RollingTranscript` + `ProgressiveAnalyzer` the same way `replay.ts` does, but score
  the resulting `RiskProfile` sequence against the fixture's expected outcome instead of
  printing it to a terminal.
- If evidence from the eval justifies a prompt or schema change, it lands in
  `agent/src/risk-profile.ts` — outside this track's owned directories, so coordinate
  before editing it; `shared/src/risk.ts` re-exports it, so a change here is a change every
  other track's typecheck will immediately see.

**Run it:**
```bash
cd agent && npm install
echo 'GEMINI_API_KEY=...' > .env   # or OPENAI_API_KEY
npm run check     # one call — verifies key + model + structured output before anything else
npm test          # 27 unit tests, no key needed (verified 2026-09-12)
npm run replay    # scripted call at 8x through the real pipeline
npm run demo      # same, at 1x / 5s interval — the rehearsed fallback demo
```
Run `check` before `replay`/`demo` — a bad key, a bad model name, and a broken schema all
look identical several seconds into a replay.

**Known unverified:** the analyzer has made real model calls via `npm run replay`/`demo`
(that's the working fallback demo per the task brief), but every *unit test*
(`analyzer.test.ts`, `transcript.test.ts`, `audio-chunker.test.ts`) uses a stub client — the
control logic (skip/no-overlap/bounded-prompt) is covered, the actual prompt and schema
behaviour against a real model is only as tested as the fixtures `npm run eval` (once it
exists) actually runs. There is currently exactly one fixture.

---

## T5 — browser LiveKit rung

One sentence: a browser tab joins a LiveKit room, transcribes the audio locally using the
sibling starter kit's existing transcription client, and POSTs segments to the gateway —
removing Twilio from the critical path entirely.

**This track has no spec yet.** `openspec/changes/add-browser-livekit-rung/` exists as a
directory but contains only `.openspec.yaml` (a schema stub, `created: 2026-09-12`) —
`npx @fission-ai/openspec@1.13.0 validate --changes --strict` fails on it ("No deltas
found") as of this writing. There is no `proposal.md`, no `design.md`, no `tasks.md`, and
no code. Anything below is inferred from the task brief and the sibling repo, not from an
approved spec — write the spec first if picking this up.

**Owns:** nothing yet. Once scoped, it should own its own slice under `server/`
(e.g. a `POST /ingest/livekit-browser` or similar route feeding a `TranscriptSource` with
`kind: "livekit"`) plus whatever browser-side code it needs — this does not live in
`mobile/` or `agent/`, so it likely needs its own directory (e.g. a `browser/` at repo
root) rather than colliding with either.

**Depends on:** `TranscriptSourceKind`'s `"livekit"` member — currently declared in
`shared/src/transcript-source.ts:22` "for completeness" with **no implementation in this
scope** (per `shared/README.md`: "LiveKit is call-only and emits no transcript"). Landing
this track means that comment becomes false and `shared/README.md` needs a one-line update
alongside the code — a `shared/` change every other track's typecheck will surface, so
coordinate before quietly making LiveKit into a transcript source underneath T1/T3, both of
which currently assume it isn't one.

**Exposes:** nothing yet.

**Extend it here (once specced):**
- Write `openspec/changes/add-browser-livekit-rung/proposal.md`, `specs/**/spec.md` (at
  least one delta against the `transcript-source` or a new capability), and `tasks.md`
  first — `openspec validate --changes --strict` is the gate, same as every other change.
- The local transcription client to port from is
  `../agents-everywhere-starter-kit/apps/web/src/lib/transcription-session.ts` — CLAUDE.md
  already flags this file as "a plain WebSocket client with no DOM dependency" intended to
  port near-unchanged; that note was written for a server-side LiveKit agent, but the same
  file is the natural starting point for doing it in-browser instead.
- A `TranscriptSource` implementation with `kind: "livekit"` needs `sequence` and
  `providerEventKey` values even though nothing forces duplicates the way Twilio does —
  the interface requires both fields regardless of transport, so pick a monotonic counter
  and a locally-generated id rather than treating them as Twilio-only concerns.
- The browser needs to reach the gateway's ingest endpoint — that endpoint doesn't exist
  until T1 builds `server/`, so this track is blocked on T1 landing at least a minimal HTTP
  surface, not just the WS fan-out.

**Run it:** nothing runnable. No spec, no code.

**Known unverified:** everything, including whether the starter kit's transcription client
actually ports without a DOM the way CLAUDE.md predicts — that prediction has never been
tested against this repo's code.
