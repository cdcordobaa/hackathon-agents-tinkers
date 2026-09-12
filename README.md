# hackathon-agents-tinkers

Workspace for the AI Tinkerers **"Agents, Everywhere"** hackathon, 12–13 September 2026.

Four projects that share one theme: putting an agent where the conversation already is —
in a browser, in Slack, in a call, on a phone.

The planned mobile scam-protection workflow is defined in the
[phased project specification](./docs/scam-protection-specification.md), covering
Twilio call validation, live transcription, alerts, critical-risk termination,
and incident reporting before implementation.

## Projects

| Folder | What it is |
|---|---|
| [`agents-everywhere-starter-kit/`](./agents-everywhere-starter-kit) | The official hackathon starter kit (CopilotKit, MIT), plus local work on a `/voice` surface |
| [`two-way-demo/`](./two-way-demo) | A two-way agent ↔ UI loop with CopilotKit v2 — the agent renders components, the UI reports back |
| [`claude-agent-server/`](./claude-agent-server) | Exposes the Claude Agent SDK over AG-UI so CopilotKit can drive it |
| [`meet-mobile-tap/`](./meet-mobile-tap) | Call-audio capture on mobile — research notes plus an Expo scaffold |

### agents-everywhere-starter-kit

Cloned from [CopilotKit/agents-everywhere-starter-kit](https://github.com/CopilotKit/agents-everywhere-starter-kit)
(MIT, `LICENSE` retained) at commit `a997712`. Local additions on top of upstream:

- `apps/web/src/lib/stereo-capture.ts` — a tab+mic stereo tap
- `apps/web/src/lib/transcription-session.ts` — a listening OpenAI Realtime session that
  transcribes without ever answering back
- edits to `realtime-config.ts` and the `realtime-token` route

### two-way-demo

A sprint board with two drivers: a human who drags cards, and an agent that can see the board,
change it, draw it, and ask permission. Every crossing of the agent/UI boundary is logged on
screen so you can watch the loop instead of inferring it.

### claude-agent-server

An AG-UI bridge for the Claude Agent SDK. Uses your local Claude Code login when no API key is set.

### meet-mobile-tap

The "in the room" surface. [`CLAUDE.md`](./meet-mobile-tap/CLAUDE.md) is the thing to read first —
it records which audio-capture paths are blocked at the OS level and which three actually work in
React Native, so the dead ends do not get re-discovered. The rule it reduces to:

> React Native can capture any call your app is a party to. It can never capture a call another
> app owns.

`mobile/` is an Expo 57 / React Native 0.86 scaffold with no capture code yet.

## Getting started

Each project is self-contained — `cd` into it and read its own README.

```bash
cd two-way-demo
cp .env.example .env.local   # add OPENAI_API_KEY
npm install
npm run dev
```

Requires Node >= 22.

## A note on secrets

No real credentials are committed. `.env.example` files are templates with placeholder values;
real keys belong in `.env.local`, which is gitignored.
