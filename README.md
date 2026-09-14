# hackathon-agents-tinkers

Workspace for [**Agents, Everywhere**](https://bogota.aitinkerers.org/hackathons/h_q4-sNJw_JYI),
the AI Tinkerers global hackathon — Bogotá chapter, 12–13 September 2026.

Several projects sharing one theme: putting an agent where the conversation already is — in a
browser, in Slack, on a phone, inside a live call. The main build is **Xentinela**, a live call
guard; the rest are the experiments and infrastructure it grew out of.

---

## What is in this repo

Each folder is self-contained. `cd` into it and read its own README.

| Folder | What it is | Status |
|---|---|---|
| [`meet-mobile-tap/`](./meet-mobile-tap) | **Xentinela** — the main build. Gateway, call monitor, browser client and Expo app | Working |
| [`xentinela/`](./xentinela) | The Xentinela app shell — client UI wired to the detection gateway | Working, partial |
| [`agents-everywhere-starter-kit/`](./agents-everywhere-starter-kit) | The official hackathon starter kit (CopilotKit, MIT) plus local work on a `/voice` surface | Reference |
| [`two-way-demo/`](./two-way-demo) | A two-way agent ↔ UI loop on CopilotKit v2 — the agent renders components, the UI reports back | Working |
| [`claude-agent-server/`](./claude-agent-server) | An AG-UI bridge exposing the Claude Agent SDK so CopilotKit can drive it | Working |
| [`docs/`](./docs) | The phased scam-protection specification — written before implementation | Spec only |

### A naming wrinkle, so it does not confuse you

**`meet-mobile-tap/` is where Xentinela lives.** The folder is named after the original question —
*can a React Native app tap the audio of a Google Meet or Zoom call?* The answer turned out to be
a firm no at the OS level, the project pivoted to being a participant in the call rather than an
eavesdropper on one, and the folder name stayed. [`meet-mobile-tap/CLAUDE.md`](./meet-mobile-tap/CLAUDE.md)
is the research trail for that dead end and is worth reading before anyone tries it again.

### The two Xentinela folders

- `meet-mobile-tap/` is the **system**: the gateway, the server-side call monitor, the browser
  participant, the Expo participant, and the shared snapshot contract between them.
- `xentinela/` is a **standalone app shell** — the client UI for the same gateway, with tabs for
  seeded calls alongside the live one. Telephony and guardian messaging are not connected there.

### Supporting work

**`agents-everywhere-starter-kit/`** — cloned from
[CopilotKit/agents-everywhere-starter-kit](https://github.com/CopilotKit/agents-everywhere-starter-kit)
(MIT, `LICENSE` retained) at `a997712`. Local additions on top of upstream:
`apps/web/src/lib/stereo-capture.ts`, a tab+mic stereo tap that merges two sources into the left
and right channels of one stream so speaker separation costs nothing; and
`apps/web/src/lib/transcription-session.ts`, a listening OpenAI Realtime session that transcribes
without ever answering back.

**`two-way-demo/`** — a sprint board with two drivers: a human who drags cards, and an agent that
can see the board, change it, draw it, and ask permission. Every crossing of the agent/UI boundary
is logged on screen so you can watch the loop instead of inferring it.

**`claude-agent-server/`** — uses your local Claude Code login when no API key is set.

Requires Node >= 22.

---

# Xentinela

**A live call guard.** Two people are on a call. One of them is being socially engineered.
Xentinela listens with consent, follows the conversation as it develops, and tells the person
being targeted what is happening — while they are still on the line.

![Xentinela setup screen](meet-mobile-tap/docs/images/setup.png)

## The problem

Scam calls do not announce themselves. They *develop*. A bank-impersonation call opens politely,
establishes authority, invents a frightening transaction, manufactures urgency, isolates you from
anyone who might talk you out of it — and only then asks for the one-time code. Each step is
individually plausible. The shape is only obvious in hindsight.

A summary after the call is useless. The money is gone.

So Xentinela re-reads the whole transcript every few seconds and revises its assessment as the
pretext builds. The score climbs with the call.

> ```
> authority claim  →  urgency  →  isolation  →  the OTP ask
>    ELEVATED 60   →     ↓      →      ↓      →    HIGH 95
> ```

![Live assessment during a call](meet-mobile-tap/docs/images/call-desktop.png)

Evidence is quoted verbatim from the transcript, in the language spoken. A finding you cannot
check against the words said is not a finding.

## See it in 30 seconds

No credentials, no microphone, no model calls, no phone:

```bash
cd meet-mobile-tap
npm run setup:gateway
npm run dev
```

Open <http://localhost:8787> → **Open demo preview**. It drops you two minutes into an evolving
call.

The persistent amber **Demo preview — no live call** banner is deliberate: simulated data must
never be able to pass for a real model result. Every screenshot here is that preview, captured
from the running app.

## On the phone

The same call, same assessment, on the device of the person being protected.

<img src="meet-mobile-tap/docs/images/call-phone.png" width="340" alt="Xentinela on a phone during a call">

React Native via Expo, with a native development build — LiveKit needs real WebRTC, so Expo Go
cannot run it.

## How it works

Everyone — both humans and the monitor — is a participant in one LiveKit room. The monitor is
simply a server-side participant that never speaks.

```mermaid
flowchart TB
    B["🖥️ Browser<br/>agent/web/"] <--> R
    P["📱 Expo app<br/>mobile/"] <--> R
    R(("LiveKit room<br/>WebRTC"))
    R -->|"per-participant<br/>AudioStream @ 16kHz"| M

    subgraph M ["Xentinela monitor · agent/src/livekit-monitor.ts"]
        direction TB
        C["AudioChunker<br/><i>12s chunks, silence-gated</i>"]
        T["Gemini transcription<br/><i>one request per speaker</i>"]
        RT["RollingTranscript<br/><i>finals only, bounded</i>"]
        A["ProgressiveAnalyzer<br/><i>revises previous assessment</i>"]
        C --> T --> RT --> A
    end

    A -->|"CallSnapshot<br/>topic: xentinela.session"| R
    R -.->|"validated + freshness-checked"| B
    R -.->|"validated + freshness-checked"| P
```

**Why a room participant and not a phone tap.** The one rule this whole project reduces to:

> React Native can capture any call your app is a party to. It can never capture a call another
> app owns.

Tapping Zoom, Meet, or the native dialer from a third-party app is blocked at the OS level on both
platforms — Android's `AudioPlaybackCapture` refuses `USAGE_VOICE_COMMUNICATION`, and iOS blocks
cross-app VoIP audio in the routing layer. Worse, Android's concurrent-capture policy does not
*fail* when you try; it hands you silence, so the recorder reports success and returns zeros.
Being a participant sidesteps all of it.

**Speaker labels are free.** Each participant is a separate audio track, so the transcript knows
who spoke without any diarization.

### The snapshot contract

One validated shape, [`shared/session.ts`](./meet-mobile-tap/shared/session.ts), rendered by both
clients. The monitor publishes; the clients only ever read. Receipt rules live in
[`shared/room-session.ts`](./meet-mobile-tap/shared/room-session.ts) and are shared so the browser
and the phone cannot drift:

- the publisher identity must be the monitor — any participant can send data on a room
- room and sequence number must match, so a stale or replayed packet is dropped
- **older than 15s is stale**, and a stale snapshot *removes* the score and the guidance

That last rule matters more than it looks. A risk score frozen on screen while the pipeline is
dead is worse than no score, because the person trusts it. Degraded states say so.

## Three ways to put a call in front of the model

Each rung is a complete demo. Rehearse from the bottom up.

| Rung | What the call is | Needs | Status |
|---|---|---|---|
| **`replay`** | Scripted call through the real pipeline | One model key | **Works** — `cd meet-mobile-tap/agent && npm run demo` |
| **`livekit`** | Two WebRTC clients in a room — a real call | LiveKit + Gemini | **Works** — browser ↔ phone |
| **`twilio`** | Real PSTN | A number, regulatory setup | Not built |

`replay` exists because a demo that depends on a network, a device, and two model providers will
fail on stage eventually. It runs the genuine `RollingTranscript` and `ProgressiveAnalyzer`
against [`agent/src/fixtures/bank-scam.ts`](./meet-mobile-tap/agent/src/fixtures/bank-scam.ts), a
Colombian bank-impersonation pretext in Spanish. Only the audio is fake.

## Decisions that took the longest to get right

Most of these are one line of code and a day of finding out.

**Analyse progressively, not repeatedly.** "Concatenate every few seconds and send it" is the
right instinct and breaks three ways on a real call, so
[`analyzer.ts`](./meet-mobile-tap/agent/src/analyzer.ts) skips a pass when no new speech arrived;
*drops* a tick that lands while a pass is still running rather than queueing it, because a queue
on a fixed interval only ever grows; and bounds the prompt by keeping the head **and** tail of the
transcript — unbounded concatenation is fine for ten minutes and fatal for an hour. The opening
pretext matters as much as the last sentence.

**Carry the previous assessment into the next prompt.** This is what makes it *progressive* rather
than recomputed. The model revises, and reports what `changed`.

**Only finalised turns reach the transcript.** Streaming deltas get revised constantly, and
analysing revised text makes the model argue with itself between passes.

**Gate on silence before spending an API call.** Not an optimisation — a correctness fix.
Transcription models hallucinate confident sentences from room tone; feed one twelve seconds of
silence and it returns something plausible, which lands in the transcript as a turn nobody said
and then gets reasoned about as evidence.
[`audio-chunker.ts`](./meet-mobile-tap/agent/src/audio-chunker.ts) measures voiced milliseconds
and drops the chunk. The transcription prompt is a second line of defence.

**Never show a reassuring zero.** Missing analysis stays pending with an em dash. A zero looks
like "checked, you're fine."

**The free tier shapes the architecture.** Gemini's free tier is single-digit requests per minute,
which is low enough that the analysis interval is a per-provider value rather than a constant. Two
speakers on 12s chunks is already 10 rpm before the analyzer asks for anything — which is the
other reason silence-gating earns its place.

## What this deliberately does not do

Stated plainly, because a demo that overstates itself is worse than a smaller honest one:

- No Twilio/PSTN. No capture of calls owned by another app — see above; it is not possible.
- No persisted transcripts. The phone's end screen reflects the last snapshot it received.
- The gateway is a **trusted-local-network demo**. No application login. Do not expose it as a
  public token service.
- The OpenSpec event log in [`openspec/`](./meet-mobile-tap/openspec) is a proposed contract, not
  yet reconciled with the shipped implementation.
- Health checks say "Configured", never "Ready" — they verify that keys exist, not that any
  provider will answer.

## What it would take to support real phone calls

Vishing happens on the phone network. A fraud product that only watches WebRTC rooms is a demo of
a technique; one that watches a real inbound PSTN call is the product. This is the gap between the
two, and it is the best-understood unbuilt thing in the repo — the design already exists as
[`add-twilio-call-transport`](./meet-mobile-tap/openspec/changes/add-twilio-call-transport).

**The shape changed once already, and that is the important part.** The original plan forked raw
audio with `<Start><Stream>`: Twilio sends μ-law 8 kHz over a WebSocket, we decode it, resample to
PCM16 24 kHz, and run our own transcription. The current plan is `<Start><Transcription>` — Twilio
does the speech-to-text and POSTs speaker-labelled segments to a callback URL. **No media
WebSocket, no μ-law decode, no resampling, no in-process STT for this path at all.** That deletes
most of the original work.

### What has to be true

| | Why it is not optional |
|---|---|
| **A paid Twilio number** | Trial accounts play a "you have a trial account" preamble before connecting. That is the specific reason [`CLAUDE.md`](./meet-mobile-tap/CLAUDE.md) rejected Twilio for the hackathon. Upgrade ≥24h before any demo. |
| **A publicly reachable gateway** | Twilio POSTs webhooks *to you*. The current gateway is localhost/LAN with no auth — this is the one change that turns it into an internet-facing service, and it needs signature validation before it is. |
| **Two callback handlers** | One for transcript segments, one for transcription start/stop/failure. The second exists so a malformed `<Start><Transcription>` surfaces as a reported failure instead of silence. |
| **Ordering and dedup** | Twilio documents out-of-order and duplicate delivery. Segments map onto `TranscriptSegment` using the payload's own sequencing and event-id fields. |
| **Prompt 200s** | The segment handler must return quickly or Twilio retries, and the retries become phantom turns in the transcript. |

### What comes free, and what does not

**Free: speaker roles.** The transcription callback carries a `Track` field per leg, so
`subject` / `counterparty` is known rather than inferred. LiveKit cannot do this — it knows there
are two participants, not which one is being defrauded.

**Free-ish: speaking into the call.** `<Say>` / `<Play>` on a call update gives `canSpeak: true`.
That is the first point where the agent could interrupt a scam in progress rather than only warn
about it.

**Not free: ending the call.** Deferred. Technically Twilio can hang up; deciding when a model is
allowed to is a different problem.

**Not free, and the real risk: the phone.** `@twilio/voice-react-native-sdk` is a native module
landing on an Expo project that already carries LiveKit's WebRTC pods. Two native telephony stacks
in one build is exactly the class of problem the team avoided elsewhere by keeping CopilotKit's
mobile integration native-module-free. The proposal flags this as a time-boxed spike and says to
confirm intent before spending it — good instinct, and worth keeping.

An alternative sidesteps it entirely: the phone does not have to be a call leg. Twilio carries the
media server-side, so the transcript and the risk profile reach the phone over the *existing*
gateway WebSocket. The app stays a screen, not a softphone. That is a smaller build than the
proposal assumes.

### Cost and the Colombian wrinkle

Cost is not the obstacle: about **$1.15/month** for a US number and **$0.0085/min** inbound —
roughly nine cents for a ten-minute demo call. Real-time transcription bills on top.

A **Colombian** number is different. Owning a local DID requires regulatory documentation, which is
paperwork with a lead time, not a credit card. *Calling* a Colombian number needs none of that. So
the realistic first version is a Colombian phone dialling a foreign number — enough to prove the
pipeline, not enough to be the product locally.

### Honest estimate

Two to three days for someone who has done Twilio webhooks before, most of it in the unglamorous
parts: making the gateway safe to expose, ordering and dedup, and measuring whether Twilio's
transcription is accurate enough in Spanish — **because in this design its quality is the
analyzer's ceiling.** The proposal makes that a measured task rather than an assumption, which is
the right call: no amount of prompt work recovers a signal the transcript never carried.

## Running a real call

Copy `meet-mobile-tap/agent/.env.example` to `agent/.env`:

| Setting | Where | Purpose |
|---|---|---|
| `LIVEKIT_URL` | [LiveKit Cloud](https://cloud.livekit.io) → project settings | Room server (`wss://…`) |
| `LIVEKIT_API_KEY` | Project → Settings → API keys | Server auth |
| `LIVEKIT_API_SECRET` | Same entry | Signs short-lived room tokens |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Transcription + default analysis |
| `OPENAI_API_KEY` | Optional | Alternative analysis; Gemini still does transcription |

Then:

1. Browser companion on the computer at <http://localhost:8787>. Pick a room, name, role, confirm
   consent, join.
2. On the phone: **LiveKit**, the gateway's printed LAN URL, the same room name, consent.
3. **Use headphones.** Check both people hear each other and the meters move.
4. Speak for at least 12 seconds — transcription works in 12s chunks, so this is not word-by-word
   captioning.

Browsers require localhost or HTTPS for microphone access. Each join gets a 30-minute room-scoped
token; provider secrets never enter the app bundle. Credentials live in ignored `agent/.env` and
are never committed.

Full phone-build and local-LiveKit instructions are in
[`meet-mobile-tap/README.md`](./meet-mobile-tap/README.md).

## Verification

```bash
cd meet-mobile-tap
npm test                          # 141 tests across agent, server, mobile
cd agent && npm run typecheck && npm run build:web
cd agent && npm run smoke:local   # two real RTC clients, synthetic audio, no models
```

The local smoke test joins two real RTC clients through the gateway and verifies two-way audible
PCM and receipt of the same monitor session by the shared snapshot receiver. It does **not** test
physical microphones, Cloud networking, or model responses.

---

## How it was built

Two days, three people, and a lot of agent-written code — where the interesting problem turned out
to be coordination rather than typing.

![Team coordination dashboard](meet-mobile-tap/docs/images/dashboard.png)

*The internal build dashboard — generated from a live status script, not hand-maintained. Tracks,
what exists, what typechecks, what is blocked. The shot above is deliberately unretouched: it
shows the board stale and five env vars missing, which is what these things actually look like
mid-hackathon. It predates the rename from SecureGuIA.*

- **One track owns a directory; nobody else writes there.** With several agents working in
  parallel, two of them editing one file is how the file and the afternoon get lost.
  [`TRACKS.md`](./meet-mobile-tap/TRACKS.md) carries the rule and the boundaries.
- **Contracts cross boundaries, not edits.** A shape change goes into `shared/`, and
  `tsc --noEmit` in every consumer names who else it touches.
- **Prose goes stale the moment someone lands a commit.** Every doc here says so, and says to
  verify against the repo.
- **The dead ends are documented as carefully as the working paths.**
  [`meet-mobile-tap/CLAUDE.md`](./meet-mobile-tap/CLAUDE.md) records which capture routes are
  blocked at the OS level and why, so the next person does not spend an afternoon rediscovering
  that Android returns silence rather than an error.

### Spec-driven development with OpenSpec

[`openspec/`](./meet-mobile-tap/openspec) holds twelve change proposals written before the code
they describe. This is the part of the process worth explaining, because it is the reason several
agents could work at once at all — and because the honest version of how it went is more useful
than the tidy one.

**Why: parallelism has a prerequisite.** Four tracks needed to start in the same hour, and three
of them — mobile UI, detection, intervention — could not begin until they knew what a call session
looked like *from the outside*. The first proposal states the problem plainly:

> Without one set of shared types and one fake behind every seam, the tracks serialise behind
> whoever is wiring audio, and integration lands at 3am on demo day.

So exactly one change, [`add-call-session-contracts`](./meet-mobile-tap/openspec/changes/add-call-session-contracts),
was declared blocking. It defined `CallSession`, the state machine, the consent gate, the event
protocol, and a `ReplayTransport` that drives the real pipeline off a scripted fixture. Once it
landed, every other track could run the whole thing end to end with no LiveKit account, no Twilio
number and no microphone. The fakes were the deliverable, not a by-product.

**How a change is shaped.** Each folder under `changes/` carries a `proposal.md` (why, what
changes, impact, what it blocks), a `design.md`, a `tasks.md`, and `specs/` written as testable
requirements rather than prose:

> **Requirement: Consent gate** — A session SHALL NOT deliver any audio frame to transcription,
> analysis, or storage while consent is unrecorded.
>
> *Scenario: Audio before consent is discarded* — **WHEN** the transport emits audio frames while
> the session is in `awaiting-consent`, **THEN** the frames are counted and discarded, no
> transcription is started, and no audio is retained.

That shape does something a prose plan cannot: `WHEN/THEN` scenarios drop almost directly into
`node:test` cases, so "is this built?" has an answer that is not an opinion.

**Why *this* way, and not a plan in a doc.** Four mechanisms did the work, and each exists because
of a specific way agent-assisted parallel building goes wrong.

*A hard planning boundary.* The propose workflow refuses to write code:

> This workflow creates planning artifacts only. The user request that selected or triggered this
> workflow authorizes planning only, **even if it asks to build or fix something**. Do not edit
> project code. After the planning artifacts are complete, stop.

Left alone, an agent asked to "add Twilio support" starts editing files in the first minute. That
is fine when one agent works alone and fatal when four do, because the design decisions that
should have been argued about get made silently, in code, in four places. Separating *deciding*
from *typing* is most of the value, and the boundary has to be enforced rather than intended.

*Fakes as the deliverable.* The blocking change shipped `ReplayTransport`, `FakeTranscriber` and
`FakeAnalyzer` as first-class outputs. That is what let the mobile track see a rising risk score
on day one with no OpenAI key, and the detection track tune prompts with no phone. A seam without
a fake behind it silently serialises every track that crosses it.

*Contracts that fail loudly when they drift.* `shared/src/risk.ts` **re-exports** the analyzer's
types from `agent/src/risk-profile.ts` instead of restating them, so a green `tsc --noEmit` in
`shared/` is mechanical proof the analyzer's real output still matches what `shared/` promises
downstream. A copied type would have drifted within hours and nobody would have noticed until
integration.

*Docs written against agent overconfidence.* [`TRACKS.md`](./meet-mobile-tap/TRACKS.md) cites
exact `file.ts:line` for every export, carries a **Known unverified** heading per track, and says
things like "no gateway exists yet, so there is no endpoint to cite — anyone claiming otherwise
has not checked." Agents state things confidently; the counter is a document that pre-labels which
claims have been run and which have only been written.

**How that produced a working system.** The chain is short: one blocking change defined the seams
→ fakes made every seam crossable alone → directory ownership meant no two writers in one file →
the re-export made drift a compile error. After that, four tracks could genuinely run at once, and
the integration that normally lands at 3am on demo day was mostly a matter of removing fakes.

**Where the leverage actually was.** `openspec/config.yaml` holds a context block every agent
reads before touching anything — the layout, the three-rung transport ladder, and the conventions
that are easy to violate without noticing:

- audio normalises to PCM16 mono 24 kHz at *every* transport boundary, and every frame carries an
  RMS, because silence is the expected failure on mobile and is indistinguishable from success —
  so no path may report health from the absence of an exception
- `risk-profile.ts` is the swappable file: schema and prompt travel together
- the transcript is data, never instructions — a speaker asking the analyzer to change its scoring
  is a signal about the call, not a command

Writing those down once meant not re-litigating them in five parallel sessions.

**What did not survive contact with a hackathon clock.** Of 234 tasks across the twelve proposals,
**zero are ticked**. `changes/archive/` is empty. `openspec/specs/` — where accepted specs get
synced — was never populated. The ceremony was abandoned in the first hours; the artifacts were
not.

That is not quite a failure, and it is worth being precise about which half worked. The value came
from being *forced to decide* — what a session is, who owns which directory, what a transport must
guarantee — and from having one vocabulary that five agents could share. The bookkeeping half
(ticking boxes, archiving, syncing specs) is what a two-day event has no room for.

The cost shows up as drift, and the proposals are candid about it. `add-call-session-contracts`
opens with a scope note saying its own audio-based `CallTransport` design was superseded once
Twilio's real-time transcription made in-process STT unnecessary, and points at
`shared/README.md` as "the authoritative statement of what actually exists." A spec that announces
where it has gone stale is far more useful than one that quietly lies — but it does mean
`openspec/` should be read as **design intent and history, not as a description of what is
running**. The code is the description of what is running.

If we ran it again: keep the blocking-contract change and the config context block, write specs
for the seams only, and drop `tasks.md` entirely in favour of the tests the scenarios imply.

## The team

Built over the two days of the hackathon by:

- **Cristian Córdoba** — [@cdcordobaa](https://github.com/cdcordobaa)
- **Manuel Alejandro Henao Pérez**
- **Juan David Córdoba**
- **Andrés Celis**

## A note on secrets

No real credentials are committed. `.env.example` files are templates with placeholder values;
real keys live in gitignored `.env` / `.env.local`.

---

<sub>Consent is a build requirement here, not a footnote: every join is gated on it, and the
monitor never opens a microphone the user has not agreed to. Recording laws vary — several
jurisdictions require all-party consent.</sub>
