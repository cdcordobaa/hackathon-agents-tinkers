/** Registry configuration shared by the combined gateway and server package entrypoint. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModelSetup } from "../../agent/src/model-client.ts";
import type { SessionAnalyzerOptions } from "./session.ts";
import { SessionRegistry } from "./session-registry.ts";
import { ReplaySource } from "./replay-source.ts";
import { BrowserTranscriptSource } from "./browser-source.ts";
import {
  attachSessionWebSocket,
  createSessionHttpHandler,
} from "./gateway.ts";
import type { TranscriptSourceKind } from "../../shared/src/index.ts";

export type SessionRuntime = {
  registry: SessionRegistry;
  analysisConfigured: boolean;
  modelDescription: string;
  defaultTransport: TranscriptSourceKind;
};

function transportFromEnv(value: string | undefined): TranscriptSourceKind {
  return value === "replay" || value === "livekit" || value === "twilio"
    ? value
    : "replay";
}

function unavailableAnalyzerClient(): SessionAnalyzerOptions["client"] {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("Risk analysis unavailable: configure an OpenAI or Gemini model key.");
        },
      },
    },
  } as unknown as SessionAnalyzerOptions["client"];
}

/** Build the legacy session registry without binding a port or requiring a model key. */
export function createSessionRuntime(env: NodeJS.ProcessEnv = process.env): SessionRuntime {
  const defaultTransport = transportFromEnv(env.DEFAULT_TRANSPORT);
  const replaySpeed = Number(env.REPLAY_SPEED) || 8;
  let analyzer: SessionAnalyzerOptions;
  let analysisConfigured = true;
  let modelDescription: string;

  try {
    const setup = resolveModelSetup(env);
    analyzer = {
      client: setup.client,
      model: setup.model,
      supportsStrictSchema: setup.supportsStrictSchema,
      intervalMs: setup.suggestedIntervalMs,
    };
    modelDescription = `${setup.provider} · ${setup.model}`;
  } catch {
    analysisConfigured = false;
    modelDescription = "risk analysis unavailable (no model key)";
    analyzer = { client: unavailableAnalyzerClient(), intervalMs: 60_000 };
  }

  const registry = new SessionRegistry({
    defaultTransportKind: defaultTransport,
    createTranscriptSource: (kind) => {
      if (kind === "replay") return new ReplaySource(undefined, replaySpeed);
      if (kind === "livekit") return new BrowserTranscriptSource();
      throw new Error(
        `transport "${kind}" has no TranscriptSource in this build — use "replay" or "livekit"`,
      );
    },
    analyzer,
  });

  return { registry, analysisConfigured, modelDescription, defaultTransport };
}

export function createSessionExtension(runtime: SessionRuntime) {
  return {
    handleHttp: createSessionHttpHandler(runtime.registry, {
      canCreateSession: () => runtime.analysisConfigured,
      unavailableMessage:
        "Replay sessions require risk analysis. Set OPENAI_API_KEY or GEMINI_API_KEY and restart the gateway.",
    }),
    attachWebSocket: (server: import("node:http").Server) => {
      const attachment = attachSessionWebSocket(server, runtime.registry);
      return {
        async close() {
          try {
            await attachment.close();
          } finally {
            await runtime.registry.dispose();
          }
        },
      };
    },
  };
}

async function runCombinedGateway(): Promise<void> {
  const { createDemoServer } = await import("../../agent/src/demo-server.ts");
  const runtime = createSessionRuntime();
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  const app = createDemoServer({
    onLog: console.log,
    extension: createSessionExtension(runtime),
  });
  app.server.listen(port, process.env.HOST ?? "0.0.0.0", () => {
    console.log(`SecureGuIA combined gateway listening on :${port}`);
    console.log(`  ${runtime.modelDescription}`);
    console.log(`  legacy session transport: ${runtime.defaultTransport}`);
    console.log(`  POST http://localhost:${port}/api/join`);
    console.log(`  POST http://localhost:${port}/session`);
    console.log(`  WS   ws://localhost:${port}/session/:id`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 12_000);
      deadline.unref();
      void app.stop().then(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runCombinedGateway().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
