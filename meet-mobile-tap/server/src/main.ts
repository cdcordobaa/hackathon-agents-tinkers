/**
 * `npm run dev` — starts the gateway. Defaults to the replay transport, so
 * this runs with no Twilio number, no LiveKit room, and no phone: the only
 * required env var is a model key for the analyzer (see model-client.ts).
 *
 * Env vars read here:
 *   PORT               gateway HTTP/WS port. Default 8787.
 *   DEFAULT_TRANSPORT  transport a bare `POST /session` gets when it does
 *                      not name one. Default "replay". "twilio"/"livekit"
 *                      are accepted by the type but not implemented in this
 *                      scope — creating a source for either throws.
 *   REPLAY_SPEED       ReplaySource's speed multiplier. Default 8 (a ~35s
 *                      scripted call finishes in a few seconds).
 * Everything else (OPENAI_API_KEY / GEMINI_API_KEY, ANALYSIS_PROVIDER,
 * ANALYSIS_MODEL, ANALYSIS_INTERVAL_MS) is agent/src/model-client.ts's
 * contract, read the same way agent/src/replay.ts already reads it.
 */
import { resolveModelSetup } from "../../agent/src/model-client.ts";
import { createGateway } from "./gateway.ts";
import { SessionRegistry } from "./session-registry.ts";
import { ReplaySource } from "./replay-source.ts";
import type { TranscriptSourceKind } from "../../shared/src/index.ts";

const PORT = Number(process.env.PORT) || 8787;
const DEFAULT_TRANSPORT = (process.env.DEFAULT_TRANSPORT as TranscriptSourceKind | undefined) ?? "replay";
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED) || 8;

let modelSetup;
try {
  modelSetup = resolveModelSetup();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  console.error("Put a model key in server/.env or agent/.env — npm run dev reads both.");
  process.exit(1);
}

const registry = new SessionRegistry({
  defaultTransportKind: DEFAULT_TRANSPORT,
  createTranscriptSource: (kind) => {
    if (kind === "replay") return new ReplaySource(undefined, REPLAY_SPEED);
    // Twilio and LiveKit transcript sources are other tracks' work — see
    // add-twilio-call-transport / the shared/ scope note on `kind: 'livekit'`.
    throw new Error(`transport "${kind}" has no TranscriptSource in this build — use "replay"`);
  },
  analyzer: {
    client: modelSetup.client,
    model: modelSetup.model,
    supportsStrictSchema: modelSetup.supportsStrictSchema,
    intervalMs: modelSetup.suggestedIntervalMs,
  },
});

const server = createGateway(registry);
server.listen(PORT, () => {
  console.log(`SecureGuIA gateway listening on :${PORT}`);
  console.log(`  ${modelSetup.provider} · ${modelSetup.model}`);
  console.log(`  default transport: ${DEFAULT_TRANSPORT}${DEFAULT_TRANSPORT === "replay" ? ` (speed ${REPLAY_SPEED}x)` : ""}`);
  console.log(`  POST http://localhost:${PORT}/session`);
  console.log(`  WS   ws://localhost:${PORT}/session/:id`);
});
