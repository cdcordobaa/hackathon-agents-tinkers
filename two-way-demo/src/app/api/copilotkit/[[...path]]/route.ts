/**
 * The runtime endpoint.
 *
 * createCopilotHonoHandler returns a Hono app; Next route handlers are
 * fetch-based, so `app.fetch` IS the handler. The catch-all [[...path]] segment
 * lets Hono route the runtime's own sub-paths, and `basePath` here must match
 * `runtimeUrl` in providers.tsx.
 *
 * TWO BACKENDS, ONE ENV VAR.
 *
 *   unset AGENT_URL  -> BuiltInAgent, billed to OPENAI_API_KEY / ANTHROPIC_API_KEY
 *   AGENT_URL=...    -> any AG-UI agent over HTTP, e.g. the Claude Agent SDK
 *                       server in ../claude-agent-server (runs on your local
 *                       Claude Code login, no API key)
 *
 * The agent id stays "default" either way, so nothing on the frontend changes —
 * useAgent({ agentId: "default" }) keeps working. That interchangeability is
 * the point of AG-UI.
 */
import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotHonoHandler } from "@copilotkit/runtime/v2";
import { makeAgent } from "@/agent/agent";

const agentUrl = process.env.AGENT_URL;

const runtime = new CopilotRuntime({
  // Factory form: a fresh agent per resolution, never one shared instance.
  agents: () => ({
    default: agentUrl ? new HttpAgent({ url: agentUrl }) : makeAgent(randomUUID()),
  }),
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app.fetch;
export const POST = app.fetch;
export const OPTIONS = app.fetch;
