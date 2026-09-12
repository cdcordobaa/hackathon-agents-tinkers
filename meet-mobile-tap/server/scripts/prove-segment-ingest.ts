/**
 * Proves `POST /session/:id/segments` end to end WITHOUT a browser: creates
 * a session on the browser ("livekit") transport, opens its event
 * WebSocket, grants consent, then POSTs a couple of recorded segments — one
 * on time, one a retry of the same `providerEventKey`, one delivered out of
 * sequence order — and prints every event the socket emits. If this script
 * ever stops showing `transcript.turn` lines, the browser rung is dead and
 * the HUD will be too (this project's own rule: silence here is the
 * expected failure, and it is indistinguishable from success unless
 * something is actively watching for the turns, which is what this does).
 *
 * Two modes:
 *
 *   npx tsx scripts/prove-segment-ingest.ts
 *     Self-contained: starts its own gateway in-process on an ephemeral
 *     port, with a stub analyzer client — no model key, no `npm run dev`
 *     needed. This is the mode `npm run verify-ingest` runs.
 *
 *   npx tsx scripts/prove-segment-ingest.ts --base-url http://localhost:8787
 *     Points at an already-running gateway (e.g. `npm run dev` in another
 *     terminal) instead of starting one. Requires a real model key on that
 *     process, same as any other use of `npm run dev`.
 *
 * Exit code is 0 only if every expected transcript.turn arrived in the
 * right order; non-zero and a printed reason otherwise.
 */
import { WebSocket } from "ws";
import { createGateway } from "../src/gateway.ts";
import { SessionRegistry } from "../src/session-registry.ts";
import { BrowserTranscriptSource } from "../src/browser-source.ts";
import type { AnalyzerOptions } from "../../agent/src/analyzer.ts";
import type { SessionEvent, TranscriptSegment } from "../../shared/src/index.ts";

const args = process.argv.slice(2);
const baseUrlArg = args.includes("--base-url") ? args[args.indexOf("--base-url") + 1] : undefined;

async function main(): Promise<void> {
  const { baseUrl, cleanup } = baseUrlArg ? { baseUrl: baseUrlArg, cleanup: async () => {} } : await startInProcessGateway();

  try {
    console.log(`[prove] gateway at ${baseUrl}`);

    const created = await postJson(`${baseUrl}/session`, { transport: "livekit" });
    console.log(`[prove] created session ${created.id} (token ${String(created.token).slice(0, 8)}...)`);

    const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/session/${created.id}`);
    const events: SessionEvent[] = [];
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as SessionEvent;
      events.push(event);
      console.log(`[ws] ${event.type}` + ("text" in event ? ` — "${(event as { text: string }).text}"` : ""));
    });
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    ws.send(JSON.stringify({ type: "session.start" }));
    ws.send(JSON.stringify({ type: "consent.granted" }));
    await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "running"), "consent to be granted");

    // One in order, one out of order, and a retry of the first — dedup and
    // reorder both proven in a single POST plus one follow-up.
    const first = recordedSegment({ sequence: 0, providerEventKey: "prove:0", text: "This is your bank calling about suspicious activity." });
    const second = recordedSegment({ sequence: 1, providerEventKey: "prove:1", text: "We need your one-time code to secure the account." });

    console.log("[prove] POSTing [second, first] — deliberately out of order");
    const batchRes = await postSegments(baseUrl, created.id, created.token, [second, first]);
    console.log(`[prove] -> ${batchRes.status} ${JSON.stringify(batchRes.body)}`);

    console.log("[prove] retrying the same POST — identical providerEventKeys");
    const retryRes = await postSegments(baseUrl, created.id, created.token, [second, first]);
    console.log(`[prove] -> ${retryRes.status} ${JSON.stringify(retryRes.body)}`);

    await waitFor(() => events.filter((e) => e.type === "transcript.turn").length >= 2, "two transcript.turn events");

    const turns = events.filter((e) => e.type === "transcript.turn") as Array<Extract<SessionEvent, { type: "transcript.turn" }>>;
    const texts = turns.map((t) => t.text);
    const expected = [first.text, second.text];

    if (turns.length !== 2) {
      throw new Error(`expected exactly 2 transcript.turn events (dedup should have absorbed the retry), got ${turns.length}: ${JSON.stringify(texts)}`);
    }
    if (JSON.stringify(texts) !== JSON.stringify(expected)) {
      throw new Error(`expected turns in sequence order ${JSON.stringify(expected)}, got ${JSON.stringify(texts)}`);
    }

    console.log("[prove] PASS — sequence-ordered, deduped transcript.turn events came out of the session WebSocket from raw POSTs alone.");

    ws.send(JSON.stringify({ type: "session.end" }));
    await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "ended"), "session to end");
    ws.terminate();
  } finally {
    await cleanup();
  }
}

function recordedSegment(overrides: Pick<TranscriptSegment, "sequence" | "providerEventKey" | "text">): TranscriptSegment {
  return {
    speakerId: "caller",
    role: "counterparty",
    isFinal: true,
    atMs: 0,
    ...overrides,
  };
}

async function startInProcessGateway(): Promise<{ baseUrl: string; cleanup: () => Promise<void> }> {
  // A stub client identical in shape to the one server/src/test-helpers.ts
  // and agent/src/analyzer.test.ts use — this script proves segment
  // ingest and transcript delivery, not the analyzer, so no real model
  // call belongs here.
  const client: AnalyzerOptions["client"] = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  risk: "low",
                  score: 0,
                  headline: "stub — this script does not exercise analysis",
                  signals: [],
                  advice: "",
                  changed: "stub",
                }),
              },
            },
          ],
        }),
      },
    },
  } as unknown as AnalyzerOptions["client"];

  const registry = new SessionRegistry({
    createTranscriptSource: (kind) => {
      if (kind === "livekit") return new BrowserTranscriptSource();
      throw new Error(`this script only wires "livekit" — got "${kind}"`);
    },
    defaultTransportKind: "livekit",
    analyzer: { client, intervalMs: 60_000 },
  });
  const server = createGateway(registry);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server did not bind a port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    cleanup: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return res.json();
}

async function postSegments(
  baseUrl: string,
  sessionId: string,
  token: string,
  segments: TranscriptSegment[],
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/session/${sessionId}/segments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ segments }),
  });
  return { status: res.status, body: await res.json() };
}

function waitFor(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

main().catch((err) => {
  console.error("[prove] FAIL —", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
