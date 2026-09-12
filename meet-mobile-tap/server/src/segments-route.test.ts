/**
 * End-to-end coverage of `POST /session/:id/segments` against a real HTTP
 * server — the trust boundary add-browser-livekit-rung specs (auth, shape,
 * rate limit) plus the two behaviours that only show up once a segment has
 * actually gone through `Session` (dedup by `providerEventKey`, reorder by
 * `sequence`). Uses a real `BrowserTranscriptSource` per session (that is
 * the thing under test) and the same stub model client
 * `gateway.test.ts`/`session.test.ts` already use, so no real model call
 * happens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { createGateway } from "./gateway.ts";
import { SessionRegistry } from "./session-registry.ts";
import { BrowserTranscriptSource } from "./browser-source.ts";
import { stubAnalyzerClient } from "./test-helpers.ts";
import type { SessionEvent, TranscriptSegment } from "../../shared/src/index.ts";

type CreatedSession = { id: string; state: string; token: string };

type ServerContext = {
  baseUrl: string;
  connect: (id: string) => WebSocket;
};

async function withServer<T>(
  fn: (ctx: ServerContext) => Promise<T>,
  sourceOptions: ConstructorParameters<typeof BrowserTranscriptSource>[0] = {},
): Promise<T> {
  const registry = new SessionRegistry({
    createTranscriptSource: (kind) => {
      if (kind === "livekit") return new BrowserTranscriptSource(sourceOptions);
      throw new Error(`test only wires "livekit" — got "${kind}"`);
    },
    defaultTransportKind: "livekit",
    analyzer: { client: stubAnalyzerClient(), intervalMs: 60_000 },
  });
  const server = createGateway(registry);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server did not bind a port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const openSockets: WebSocket[] = [];
  const connect = (id: string): WebSocket => {
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/session/${id}`);
    openSockets.push(ws);
    return ws;
  };

  try {
    return await fn({ baseUrl, connect });
  } finally {
    for (const ws of openSockets) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: "POST", headers: { "content-type": "application/json", ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
        });
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function createSession(baseUrl: string): Promise<CreatedSession> {
  const { body } = await postJson(`${baseUrl}/session`, { transport: "livekit" });
  return body as CreatedSession;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("open", () => resolve()));
}

function collectEvents(ws: WebSocket, events: SessionEvent[]): void {
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
}

const waitFor = (predicate: () => boolean, timeoutMs = 2000): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for condition"));
      setTimeout(poll, 5);
    };
    poll();
  });

/** Gets a session past consent so segments actually reach the transcript,
 *  not just the source's own onSegment callback. */
async function runToConsent(connect: (id: string) => WebSocket, id: string): Promise<{ ws: WebSocket; events: SessionEvent[] }> {
  const ws = connect(id);
  const events: SessionEvent[] = [];
  collectEvents(ws, events);
  await opened(ws);
  ws.send(JSON.stringify({ type: "session.start" }));
  ws.send(JSON.stringify({ type: "consent.granted" }));
  await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "running"));
  return { ws, events };
}

/** `grantConsent()` starts ProgressiveAnalyzer's own setInterval
 *  (agent/src/analyzer.ts), which only clears on `stop()` — reached only via
 *  `Session.end()`. Every test that calls `runToConsent` must call this
 *  before returning, or the interval outlives the test and `node --test`
 *  never exits (the failure mode this repo's own gateway.test.ts already
 *  comments on). */
async function endSession(ws: WebSocket, events: SessionEvent[]): Promise<void> {
  ws.send(JSON.stringify({ type: "session.end" }));
  await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "ended"));
}

function segment(overrides: Partial<TranscriptSegment> & Pick<TranscriptSegment, "sequence" | "providerEventKey">): TranscriptSegment {
  return {
    speakerId: "browser-1",
    role: "counterparty",
    text: `turn ${overrides.sequence}`,
    isFinal: true,
    atMs: 0,
    ...overrides,
  };
}

test("a segment with no credential is refused before any session lookup", async () => {
  await withServer(async ({ baseUrl }) => {
    const created = await createSession(baseUrl);
    const res = await postJson(`${baseUrl}/session/${created.id}/segments`, {
      segments: [segment({ sequence: 0, providerEventKey: "k0" })],
    });
    assert.equal(res.status, 401);

    // Also true for a session id that was never created — the missing-
    // credential check must not depend on the id resolving to anything.
    const resUnknown = await postJson(`${baseUrl}/session/does-not-exist/segments`, {
      segments: [segment({ sequence: 0, providerEventKey: "k0" })],
    });
    assert.equal(resUnknown.status, 401);
  });
});

test("a session id the caller's credential does not authorise is refused, and nothing is written", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const victim = await createSession(baseUrl);
    const attacker = await createSession(baseUrl);
    const { ws, events } = await runToConsent(connect, victim.id);

    // The attacker holds a real, valid token — just for a different session.
    const res = await postJson(
      `${baseUrl}/session/${victim.id}/segments`,
      { segments: [segment({ sequence: 0, providerEventKey: "fabricated" })] },
      { authorization: `Bearer ${attacker.token}` },
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.accepted, 0);

    // Give the (correctly refused) write a beat to have landed if it were
    // ever going to, then assert it did not.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(events.some((e) => e.type === "transcript.turn"), false, "a forged segment must never reach the victim's transcript");
    await endSession(ws, events);
  });
});

test("a malformed payload is rejected with a 4xx and never reaches the session", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await createSession(baseUrl);
    const { ws, events } = await runToConsent(connect, created.id);

    const cases: unknown[] = [
      {}, // no segments key at all
      { segments: "nope" },
      { segments: [] },
      { segments: [{ speakerId: "x" }] }, // missing most required fields
      { segments: [{ ...segment({ sequence: 0, providerEventKey: "k0" }), role: "villain" }] },
      { segments: [{ ...segment({ sequence: 0, providerEventKey: "k0" }), sequence: "0" }] },
    ];

    for (const body of cases) {
      const res = await postJson(`${baseUrl}/session/${created.id}/segments`, body, {
        authorization: `Bearer ${created.token}`,
      });
      assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx for ${JSON.stringify(body)}, got ${res.status}`);
    }

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(events.some((e) => e.type === "transcript.turn"), false);
    await endSession(ws, events);
  });
});

test("an authorised, well-formed segment reaches the session and comes out as transcript.turn", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await createSession(baseUrl);
    const { ws, events } = await runToConsent(connect, created.id);

    const res = await postJson(
      `${baseUrl}/session/${created.id}/segments`,
      { segments: [segment({ sequence: 0, providerEventKey: "k0", text: "your account is compromised" })] },
      { authorization: `Bearer ${created.token}` },
    );
    assert.equal(res.status, 202);
    assert.equal(res.body.accepted, 1);

    await waitFor(() => events.some((e) => e.type === "transcript.turn"));
    const turn = events.find((e) => e.type === "transcript.turn") as Extract<SessionEvent, { type: "transcript.turn" }>;
    assert.equal(turn.text, "your account is compromised");
    assert.equal(turn.speakerId, "browser-1");
    await endSession(ws, events);
  });
});

test("dedup: a retried POST with the same providerEventKey never produces a second transcript.turn", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await createSession(baseUrl);
    const { ws, events } = await runToConsent(connect, created.id);
    const body = { segments: [segment({ sequence: 0, providerEventKey: "retry-key", text: "one turn" })] };
    const headers = { authorization: `Bearer ${created.token}` };

    const first = await postJson(`${baseUrl}/session/${created.id}/segments`, body, headers);
    assert.equal(first.status, 202);
    await waitFor(() => events.filter((e) => e.type === "transcript.turn").length === 1);

    // Byte-for-byte the same body — exactly what TranscriptPoster's retry
    // sends (web/src/gateway/transcript-poster.ts).
    const retry = await postJson(`${baseUrl}/session/${created.id}/segments`, body, headers);
    assert.equal(retry.status, 202, "the route itself still accepts it — dedup is Session's job, done silently");

    await new Promise((r) => setTimeout(r, 50));
    const turns = events.filter((e) => e.type === "transcript.turn");
    assert.equal(turns.length, 1, "the retried providerEventKey must not double-append the turn");
    await endSession(ws, events);
  });
});

test("ordering: segments POSTed out of sequence order land in sequence order", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await createSession(baseUrl);
    const { ws, events } = await runToConsent(connect, created.id);

    // Scrambled on the wire — the gateway must not trust arrival order.
    const scrambled = [
      segment({ sequence: 2, providerEventKey: "k2", text: "third" }),
      segment({ sequence: 0, providerEventKey: "k0", text: "first" }),
      segment({ sequence: 1, providerEventKey: "k1", text: "second" }),
    ];

    const res = await postJson(
      `${baseUrl}/session/${created.id}/segments`,
      { segments: scrambled },
      { authorization: `Bearer ${created.token}` },
    );
    assert.equal(res.status, 202);
    assert.equal(res.body.accepted, 3);

    await waitFor(() => events.filter((e) => e.type === "transcript.turn").length === 3);
    const texts = events
      .filter((e) => e.type === "transcript.turn")
      .map((e) => (e as Extract<SessionEvent, { type: "transcript.turn" }>).text);
    assert.deepEqual(texts, ["first", "second", "third"], "sequence, not arrival order, decides transcript order");
    await endSession(ws, events);
  });
});

test("rate limit: a runaway client is capped, not allowed to drive unbounded ingestion", async () => {
  await withServer(
    async ({ baseUrl, connect }) => {
      const created = await createSession(baseUrl);
      const { ws, events } = await runToConsent(connect, created.id);

      const segments = Array.from({ length: 5 }, (_, i) => segment({ sequence: i, providerEventKey: `k${i}`, text: `t${i}` }));
      const res = await postJson(
        `${baseUrl}/session/${created.id}/segments`,
        { segments },
        { authorization: `Bearer ${created.token}` },
      );

      assert.equal(res.status, 202, "the first 2 of 5 still get through");
      assert.equal(res.body.accepted, 2, "the rate limiter, not the route, decides how many of this batch land");

      await new Promise((r) => setTimeout(r, 50));
      assert.equal(events.filter((e) => e.type === "transcript.turn").length, 2);
      await endSession(ws, events);
    },
    { maxSegmentsPerWindow: 2, windowMs: 60_000 },
  );
});

test("rate limit: a batch that is entirely over budget is refused with 429", async () => {
  await withServer(
    async ({ baseUrl, connect }) => {
      const created = await createSession(baseUrl);
      const { ws, events } = await runToConsent(connect, created.id);

      // Exhaust the window first.
      await postJson(
        `${baseUrl}/session/${created.id}/segments`,
        { segments: [segment({ sequence: 0, providerEventKey: "k0" })] },
        { authorization: `Bearer ${created.token}` },
      );

      const res = await postJson(
        `${baseUrl}/session/${created.id}/segments`,
        { segments: [segment({ sequence: 1, providerEventKey: "k1" })] },
        { authorization: `Bearer ${created.token}` },
      );
      assert.equal(res.status, 429);
      assert.equal(res.body.accepted, 0);
      await endSession(ws, events);
    },
    { maxSegmentsPerWindow: 1, windowMs: 60_000 },
  );
});

test("a segment posted to a non-browser-transport session is refused with 409", async () => {
  // A trivial replay-shaped stub is enough here — the assertion is only
  // about the ingest route's transport check, not about ReplaySource itself
  // (that has its own suite in replay-source.test.ts).
  const registry = new SessionRegistry({
    createTranscriptSource: () => ({
      kind: "replay" as const,
      start: () => {},
      stop: () => {},
      onSegment: () => () => {},
      onSpeaker: () => () => {},
      onEnded: () => () => {},
    }),
    defaultTransportKind: "replay",
    analyzer: { client: stubAnalyzerClient(), intervalMs: 60_000 },
  });
  const server = createGateway(registry);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("server did not bind a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const created = await createSession(baseUrl);

    const res = await postJson(
      `${baseUrl}/session/${created.id}/segments`,
      { segments: [segment({ sequence: 0, providerEventKey: "k0" })] },
      { authorization: `Bearer ${created.token}` },
    );
    assert.equal(res.status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
