# Two-way agent ↔ UI demo (CopilotKit v2)

A sprint board with two drivers: a human who drags cards, and an agent that can
see the board, change it, draw it, and ask permission. Every crossing of the
agent/UI boundary is logged on screen so you can watch the loop instead of
inferring it.

## Run it

```bash
cp .env.example .env.local     # add OPENAI_API_KEY
npm install
npm run dev                    # http://localhost:3200
```

## What to try

| Do this | Watch for |
|---|---|
| Drag **AE-102** to Review | The agent reacts unprompted — it was told, and it answers |
| "What's wrong with this board?" | It draws a card instead of writing a paragraph (`useComponent`) |
| "Move AE-105 to in progress" | The card moves in the board on the left (`useFrontendTool`) |
| "Tidy this up" | A plan card with Apply/Discard — the agent is **stopped** until you click |
| Click Apply | Cards move, and the agent resumes knowing exactly what happened |
| Drag a card *while* the agent is typing | The drag is queued, then delivered — no re-entrant run |

## The five channels

Four are hooks, all registered in `src/components/agent-bridge.tsx`. The fifth
is not a hook at all, and it is the one most people miss.

| Channel | Direction | Where |
|---|---|---|
| `useAgentContext` | UI → agent, ambient | `agent-bridge.tsx` — board re-sent every turn, triggers nothing |
| `useFrontendTool` | agent → UI | `agent-bridge.tsx` — `move_card`, `block_card`, `add_card` |
| `useComponent` | agent → UI | `agent-bridge.tsx` — `render_board`, renders `BoardCard` |
| `useHumanInTheLoop` | round trip | `agent-bridge.tsx` — `propose_reorganization`, agent **blocks** on `respond()` |
| `addMessage` + `runAgent` | UI → agent, triggers a turn | `use-board.ts::reportToAgent` |

### The one that isn't a hook

A drag has to *start a turn*. There is no hook for that — you do it yourself:

```ts
agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "[ui] I moved AE-102 to Review." });
await copilotkit.runAgent({ agent });
```

That pair is the whole mechanism. `use-board.ts` wraps it with a re-entrancy
guard, because a run already in flight must not be re-entered — a drag during a
run records its message and triggers one more run when the current one finishes.

### Choosing between them

- Agent must have the answer before continuing → **`useHumanInTheLoop`**
- Agent should notice and react to an interaction → **`addMessage` + `runAgent`**
- Agent just needs to know the current picture → **`useAgentContext`**
- Agent should run app logic → **`useFrontendTool`**
- Agent should draw something → **`useComponent`**

They compose. This page uses all five at once.

## Layout

```
src/
  agent/agent.ts              BuiltInAgent + prompt. Server only. maxSteps: 10.
  app/api/copilotkit/…/route.ts   Hono handler mounted as a Next route
  app/page.tsx                Presentational. Owns nothing.
  components/
    agent-bridge.tsx          ← every channel is registered here and nowhere else
    use-board.ts              State + reportToAgent (the addMessage/runAgent pair)
    agent-cards.tsx           Components the AGENT renders (all props optional)
    board-view.tsx            The board. Knows nothing about CopilotKit.
    channel-log.tsx           The on-screen proof that the loop is two-way
  lib/board.ts                Pure domain. No React, no CopilotKit.
```

`board-view.tsx` having no CopilotKit import is deliberate: it's what retrofitting
an agent onto an existing UI actually looks like. The drag handler calls the same
reducer the agent's tool calls.

## Traps this demo is built to avoid

- **`maxSteps` defaults to 1.** The agent would call one tool and stop before
  reading the result — the loop never closes. `agent.ts` sets 10.
- **Streamed partial args.** Renderers receive tool arguments token by token,
  *before* Zod defaults apply. Every prop in `agent-cards.tsx` is optional and
  every array is guarded. Schema defaults alone are not enough.
- **`respond` is only a function while the call is executing.** Narrow on its
  presence rather than importing a status enum from a transitive dependency.
- **Stale closures.** Tool handlers outlive renders, so `use-board.ts` reads the
  board through a ref — otherwise an agent tool acts on an old snapshot.
- **Re-entrant runs.** Guarded in `reportToAgent`.
- **`runtimeUrl` and `basePath` must agree** — `/api/copilotkit` in both
  `providers.tsx` and `route.ts`.
- **Next + `export *`.** `react-core/v2` can't cross a server/client boundary
  directly, hence the `"use client"` re-export in `providers.tsx`.

## Adapting it

Swap `lib/board.ts` for your domain and rewrite the tool descriptions in
`agent-bridge.tsx`. The plumbing — bridge, controller, log — is domain-agnostic.

To point at your own agent instead of the built-in one, replace the body of
`makeAgent` with any AG-UI endpoint and nothing else changes:

```ts
import { HttpAgent } from "@ag-ui/client";
return new HttpAgent({ url: process.env.AGENT_URL! });
```
