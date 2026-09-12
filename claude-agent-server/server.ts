/**
 * Claude Agent SDK, exposed over AG-UI.
 *
 * CopilotKit's runtime speaks AG-UI to any agent that can stream AG-UI events
 * over HTTP. This process is that agent: it hands each run to
 * ClaudeAgentAdapter and streams the resulting events back as SSE.
 *
 * AUTH. The Agent SDK spawns the same Claude Code binary the `claude` CLI uses.
 * With no ANTHROPIC_API_KEY in the environment it falls back to the local
 * Claude Code login, which is what makes this work on a subscription. Set
 * ANTHROPIC_API_KEY to bill an API key instead. This is a LOCAL DEVELOPMENT
 * convenience: subscription credentials are tied to this machine's login and
 * will not work from a deployed host.
 *
 * THE THING TO WATCH. CopilotKit sends the frontend's tools (move_card,
 * render_board, propose_reorganization, ...) on every run, in `input.tools`.
 * The adapter has to forward them to Claude or the agent can render text but
 * cannot drive the board. The startup banner and per-run log print exactly what
 * arrived, so a failure here is visible rather than mysterious.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { ClaudeAgentAdapter } from "@ag-ui/claude-agent-sdk";
import { SYSTEM_PROMPT } from "../two-way-demo/src/agent/prompt.ts";

const PORT = Number(process.env.AGENT_PORT ?? 8000);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

// An empty string is not a credential. Unset it so the SDK takes the OAuth path
// instead of trying to authenticate with "".
if (!process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;
const authMode = process.env.ANTHROPIC_API_KEY
  ? "ANTHROPIC_API_KEY (billed to the API key)"
  : "local Claude Code login (subscription)";

/** The Claude Code executable to drive. Explicit env wins, else whatever is on PATH. */
function resolveClaudeBinary(): string | undefined {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  try {
    const found = execFileSync("/usr/bin/env", ["which", "claude"], { encoding: "utf8" }).trim();
    return found || undefined;
  } catch {
    return undefined; // Fall back to the SDK's bundled binary, if it has one.
  }
}

const CLAUDE_BIN = resolveClaudeBinary();

/**
 * ONE adapter for the process, not one per run.
 *
 * The adapter does session resume for multi-turn, keyed by threadId — a fresh
 * adapter per request would start every turn from a cold session and lose the
 * conversation. Frontend tools do NOT belong here: `ClaudeAgentAdapterConfig`
 * is AgentConfig & the Claude SDK's own Options, which has allowedTools and
 * mcpServers but no AG-UI tool list. The adapter reads `input.tools` inside
 * run() and builds a dynamic in-process MCP server from them, so the tools
 * arrive per-run automatically.
 */
const agent = new ClaudeAgentAdapter({
  agentId: "claude_agent",
  model: MODEL,
  systemPrompt: SYSTEM_PROMPT,
  permissionMode: "dontAsk",
  maxTurns: 10,

  // Disable every Claude Code built-in (Bash, Read, Write, WebSearch, ToolSearch...).
  // "[] (empty array) - Disable all built-in tools" per the SDK Options docs.
  // MCP tools are a SEPARATE channel, so the ag_ui server carrying the app's
  // frontend tools is untouched.
  //
  // Why this matters here: this agent runs a sprint board. It has no business
  // reading the filesystem or searching the web, and the built-ins actively hurt
  // — Claude called ToolSearch before every unfamiliar tool, costing a round
  // trip, and their results are not shaped like AG-UI tool results, which is
  // what the CopilotKit Inspector choked on parsing.
  tools: [],

  // The SDK normally runs a native binary shipped as an OPTIONAL npm dependency.
  // If that optional package did not install (a flaky network is enough), every
  // run dies with "Native CLI binary for <platform> not found". Pointing at the
  // Claude Code binary already on this machine avoids the download entirely —
  // and it is the same binary `claude -p` uses, so the OAuth login carries over.
  pathToClaudeCodeExecutable: CLAUDE_BIN,
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: MODEL, auth: authMode, binary: CLAUDE_BIN ?? "sdk bundled" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  let input: RunAgentInput;
  try {
    input = JSON.parse(await readBody(req)) as RunAgentInput;
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Invalid AG-UI run input: ${String(error)}` }));
    return;
  }

  const runId = input.runId ?? randomUUID();
  const threadId = input.threadId ?? randomUUID();
  const encoder = new EventEncoder();

  const toolNames = (input.tools ?? []).map((tool) => tool.name);
  console.log(
    `[run ${runId.slice(0, 8)}] messages=${input.messages?.length ?? 0} ` +
      `tools=${toolNames.length ? toolNames.join(", ") : "NONE - frontend tools did not arrive"}`,
  );

  // The return leg. A frontend tool call is answered on the NEXT run, as a
  // role:"tool" message. Printing them is the only way to see whether the
  // browser actually ran the handler and what it sent back.
  for (const message of (input.messages ?? []) as Array<Record<string, unknown>>) {
    if (message.role === "tool") {
      const body = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      console.log(`[run ${runId.slice(0, 8)}]   <- tool result (${String(message.toolCallId).slice(0, 12)}): ${String(body).slice(0, 220)}`);
    }
    if (Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls as Array<Record<string, any>>) {
        console.log(`[run ${runId.slice(0, 8)}]   -> called ${call?.function?.name}(${String(call?.function?.arguments).slice(0, 120)})`);
      }
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const subscription = agent.run({ ...input, runId, threadId }).subscribe({
    next: (event) => res.write(encoder.encodeSSE(event)),
    error: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[run ${runId.slice(0, 8)}] ERROR: ${message}`);
      res.write(encoder.encodeSSE({ type: EventType.RUN_ERROR, runId, threadId, message }));
      res.end();
    },
    complete: () => {
      console.log(`[run ${runId.slice(0, 8)}] complete`);
      res.end();
    },
  });

  res.on("close", () => subscription.unsubscribe());
});

server.listen(PORT, () => {
  console.log(`\n  Claude Agent SDK over AG-UI`);
  console.log(`  listening  http://localhost:${PORT}`);
  console.log(`  model      ${MODEL}`);
  console.log(`  auth       ${authMode}`);
  console.log(`  binary     ${CLAUDE_BIN ?? "sdk bundled (optional dep)"}`);
  console.log(`\n  Point the demo at it:  AGENT_URL=http://localhost:${PORT} npm run dev\n`);
});
