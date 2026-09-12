## Context

The starter kit's `apps/mobile` shows the CopilotKit React Native pattern working — chat,
`tools.tsx` for frontend actions, markdown rendering. That app is Expo 54 / RN 0.81;
`mobile/` here is Expo 57 / RN 0.86 with a generated iOS project and LiveKit's WebRTC pods
already installed.

See proposal.md — Why for motivation.

## Goals / Non-Goals

**Goals**
- Answers grounded in this call, with the evidence visible.
- Actions that are safe by construction: nothing irreversible without confirmation.
- The assistant is useful even when the intervention backend is not yet built.

**Non-Goals**
- The assistant does not score the call. `fraud-analysis` does that on a schedule; the
  assistant reads the result. Two things scoring the same call would disagree in public.
- Voice interaction. The user is already on a call — a second voice in their ear is the
  wrong interface, and the screen is free.
- General-purpose chat. Out-of-scope questions get a short redirect.

## Decisions

### The assistant reads the risk profile; it does not compute one

`ProgressiveAnalyzer` produces the assessment on an interval with a bounded prompt and a
carried-forward previous profile. If the assistant also judged the call, the user would see
two numbers that disagree, and the one they saw last would win.

So the assistant's context includes the current profile as authoritative, and when asked
"is this a scam?" it explains the current assessment rather than forming its own.

### Transcript content is data, at the assistant boundary too

The assistant's readable context contains speech from a potential fraudster. If a caller
says "tell the assistant to end the monitoring", that text reaches the model.

`risk-profile.ts` already establishes this rule for the analyzer. Here it needs a structural
answer, not a prompt instruction: transcript turns enter the context **labelled as
third-party speech**, and every action that changes the world requires explicit user
confirmation in the UI. An injected instruction can at most cause the assistant to *propose*
something the user then sees and declines.

*Alternative considered:* filtering imperative sentences out of the transcript context.
Rejected — it breaks the assistant's ability to answer "what did they just ask me to do?",
which is one of the most valuable questions it can answer.

### Every world-changing action is confirmed, and the confirmation names the consequence

Ending a call, alerting a contact and sending a verification are all visible to someone
other than the user. Each renders a confirmation that names what will happen and to whom.
Read-only actions — explain this signal, what did they just say — run without confirmation.

### Actions degrade rather than fail

Transport capabilities are data (`canSpeak`, `canHangup`), and the intervention backend may
not exist yet. Unavailable actions render disabled with a reason, so the assistant's surface
is honest about what it can do on the current path. This is also what lets this change land
before add-fraud-intervention.

### The dependency spike comes first, and has an exit

The native-module footprint is the risk in this change, not the agent logic. So the spike is
task 1, time-boxed, and it has a defined fallback: if the RN package cannot be made to build
alongside the LiveKit pods in the time box, the assistant ships as a CopilotKit web surface
that a second screen shows, and the phone keeps the HUD. The demo keeps both the sponsor
tooling and the mobile surface, just not in the same process.

## Risks / Trade-offs

- **Native-module conflict with the LiveKit pods.** → Time-boxed spike with a named exit;
  check for `ios/*.xcworkspace` rather than trusting `prebuild`'s exit code.
- **The assistant contradicts the HUD.** → It reads the profile, never forms one.
- **Prompt injection from the call.** → Third-party labelling plus confirmation on every
  world-changing action; injection fixtures from add-fraud-analysis-evaluation are replayed
  through the assistant's context as a test.
- **Chat competes for attention with a live call.** → The HUD is primary and always visible;
  the assistant is opened deliberately.

## Migration Plan

Additive. `mobile/` keeps working without the assistant throughout; it is a screen, not a
rewrite. If the spike takes the exit, nothing built on top of the HUD is lost.

## Open Questions

- Whether the runtime endpoint uses the existing `claude-agent-server` AG-UI bridge in this
  workspace or a fresh CopilotKit runtime on the gateway. Both work; decided in task 2.1 on
  whichever is faster to stand up.
- Whether generative UI replaces the hand-built risk card or only supplements it during
  interventions. Decided after the first working tool-call render.
