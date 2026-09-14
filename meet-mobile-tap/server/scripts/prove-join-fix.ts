/**
 * Proves the actual live-demo topology WITHOUT a browser, a room, or a
 * phone: two independent WebSocket clients on the SAME gateway session,
 * where only the first one ever POSTs anything.
 *
 *   "browser" — POSTs /session (transport "livekit", exactly what web/
 *               does), keeps the ingest token, opens a WS, sends
 *               session.start + consent.granted, then POSTs segments with
 *               that token.
 *   "phone"   — opens a SECOND WS to the SAME session id and sends only
 *               `{type:"subscribe"}` — no POST /session, no session.start.
 *               This is mobile/src/gateway/client.ts's `join()` mode,
 *               exercised here against a real gateway instead of a stub.
 *
 * This is the exact bug this script exists to catch: before the join fix,
 * the phone's only way to see a call was to POST its own /session, which
 * mints a SEPARATE session id — the phone would then be watching a session
 * the browser never touches, and would show nothing while looking exactly
 * like a transcription failure. If this script's phone socket ever stops
 * seeing transcript.turn / risk.updated events, that bug is back.
 *
 * The consent gate is asserted from the phone's side too: the phone must
 * see the "awaiting-consent" and "running" transitions on the wire (it
 * does not, and must not, cause them — it never sends consent.granted).
 *
 * Segments are POSTed deliberately out of order, then one batch is retried
 * with identical providerEventKeys, proving dedup/reorder survive being
 * observed by a subscriber that did none of the driving.
 *
 * Run with `npm run verify-join` (self-contained: starts its own gateway
 * in-process on an ephemeral port with a stub analyzer, analyzer interval
 * shortened so a risk.updated pass is not a multi-minute wait).
 *
 * Exit code 0 only if the phone socket independently observed: both state
 * transitions, both transcript.turn events in sequence order with no
 * duplicate, and at least one risk.updated. Non-zero and a printed reason
 * otherwise.
 */
import { WebSocket } from "ws";
import { createGateway } from "../src/gateway.ts";
import { SessionRegistry } from "../src/session-registry.ts";
import { BrowserTranscriptSource } from "../src/browser-source.ts";
import type { AnalyzerOptions } from "../../agent/src/analyzer.ts";
import type { SessionEvent, TranscriptSegment } from "../../shared/src/index.ts";

async function main(): Promise<void> {
  const { baseUrl, cleanup } = await startInProcessGateway();

  try {
    console.log(`[prove-join] gateway at ${baseUrl}`);

    // ---- step 1: the BROWSER creates the session -------------------------
    const created = await postJson(`${baseUrl}/session`, { transport: "livekit" });
    console.log(`[prove-join] browser created session ${created.id} (token ${String(created.token).slice(0, 8)}...)`);

    const browserEvents: SessionEvent[] = [];
    const browserWs = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/session/${created.id}`);
    browserWs.on("message", (raw) => browserEvents.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => browserWs.once("open", () => resolve()));

    // ---- step 2: the PHONE joins the SAME session id, no POST -------------
    const phoneEvents: SessionEvent[] = [];
    const phoneWs = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/session/${created.id}`);
    phoneWs.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as SessionEvent;
      phoneEvents.push(event);
      console.log(`[phone ws] ${event.type}` + ("text" in event ? ` — "${(event as { text: string }).text}"` : ""));
    });
    await new Promise<void>((resolve) => phoneWs.once("open", () => resolve()));
    phoneWs.send(JSON.stringify({ type: "subscribe" }));
    // The phone NEVER sends session.start or consent.granted from here on —
    // that is the entire point. If the phone could move the session, this
    // would not prove a joined subscriber, it would prove a second driver.

    // ---- step 3: the BROWSER drives the session to running ----------------
    browserWs.send(JSON.stringify({ type: "session.start" }));
    browserWs.send(JSON.stringify({ type: "consent.granted" }));
    await waitFor(() => phoneEvents.some((e) => e.type === "session.state" && e.state === "running"), "phone to observe session reach running");

    const phoneSawAwaitingConsent = phoneEvents.some((e) => e.type === "session.state" && e.state === "awaiting-consent");
    if (!phoneSawAwaitingConsent) {
      throw new Error("phone never observed 'awaiting-consent' — the joined subscriber is missing backlog/live state events");
    }
    console.log("[prove-join] phone independently observed awaiting-consent -> running, without ever sending session.start or consent.granted");

    // ---- step 4: the BROWSER posts segments, out of order, with a retry ---
    const first = recordedSegment({ sequence: 0, providerEventKey: "join-fix:0", text: "This is your bank calling about suspicious activity." });
    const second = recordedSegment({ sequence: 1, providerEventKey: "join-fix:1", text: "We need your one-time code to secure the account." });

    console.log("[prove-join] browser POSTing [second, first] — deliberately out of order");
    const batchRes = await postSegments(baseUrl, created.id, created.token, [second, first]);
    console.log(`[prove-join] -> ${batchRes.status} ${JSON.stringify(batchRes.body)}`);

    console.log("[prove-join] browser retrying the same POST — identical providerEventKeys");
    const retryRes = await postSegments(baseUrl, created.id, created.token, [second, first]);
    console.log(`[prove-join] -> ${retryRes.status} ${JSON.stringify(retryRes.body)}`);

    // ---- step 5: assert the PHONE (not the browser) sees the result -------
    await waitFor(() => phoneEvents.filter((e) => e.type === "transcript.turn").length >= 2, "phone to receive two transcript.turn events");
    await waitFor(() => phoneEvents.some((e) => e.type === "risk.updated"), "phone to receive a risk.updated event");

    const phoneTurns = phoneEvents.filter((e) => e.type === "transcript.turn") as Array<Extract<SessionEvent, { type: "transcript.turn" }>>;
    const phoneTexts = phoneTurns.map((t) => t.text);
    const expected = [first.text, second.text];

    if (phoneTurns.length !== 2) {
      throw new Error(`phone: expected exactly 2 transcript.turn events (dedup should have absorbed the retry), got ${phoneTurns.length}: ${JSON.stringify(phoneTexts)}`);
    }
    if (JSON.stringify(phoneTexts) !== JSON.stringify(expected)) {
      throw new Error(`phone: expected turns in sequence order ${JSON.stringify(expected)}, got ${JSON.stringify(phoneTexts)}`);
    }

    const phoneRisk = phoneEvents.find((e) => e.type === "risk.updated") as Extract<SessionEvent, { type: "risk.updated" }>;
    console.log(`[prove-join] phone received risk.updated — level=${phoneRisk.profile.risk} score=${phoneRisk.profile.score} headline="${phoneRisk.profile.headline}"`);

    // Sanity check the OTHER direction too: the browser's own socket must
    // see exactly the same ordered/deduped turns, or this would just be
    // proving the phone is broken in a way that happens to look right.
    const browserTurns = browserEvents.filter((e) => e.type === "transcript.turn") as Array<Extract<SessionEvent, { type: "transcript.turn" }>>;
    if (JSON.stringify(browserTurns.map((t) => t.text)) !== JSON.stringify(expected)) {
      throw new Error(`browser's own socket disagrees with the phone's view — got ${JSON.stringify(browserTurns.map((t) => t.text))}`);
    }

    console.log(
      "[prove-join] PASS — a joined subscriber that never called POST /session and never drove the state machine " +
        "independently received ordered, deduplicated transcript.turn events and a risk.updated for a session only the browser created and fed. " +
        "This is the phone seeing the browser's call.",
    );

    browserWs.send(JSON.stringify({ type: "session.end" }));
    await waitFor(() => phoneEvents.some((e) => e.type === "session.state" && e.state === "ended"), "phone to observe session end");
    browserWs.terminate();
    phoneWs.terminate();
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
  // Same stub-client shape as prove-segment-ingest.ts — this script proves
  // event delivery to an independent subscriber, not analysis quality, so no
  // real model call belongs here. intervalMs is cut way down from the 6s
  // production default purely so this script does not sit around for a
  // multi-second analyzer tick before it can assert risk.updated arrived.
  const client: AnalyzerOptions["client"] = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  risk: "high",
                  score: 82,
                  headline: "Caller is requesting a one-time code — classic account-takeover pattern.",
                  signals: [],
                  advice: "Do not share the code. Hang up and call your bank back on a known number.",
                  changed: "risk escalated",
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
    analyzer: { client, intervalMs: 50, minNewSegments: 1 },
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
  console.error("[prove-join] FAIL —", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
