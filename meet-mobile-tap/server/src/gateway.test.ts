/**
 * Exercises the real HTTP + WS surface end to end — the closest thing this
 * package has to "does `npm run dev` actually serve a session", short of
 * hitting the real network. Uses an in-process FakeTranscriptSource and a
 * stub model client so it never depends on Twilio, LiveKit or a model key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { createGateway } from "./gateway.ts";
import { SessionRegistry } from "./session-registry.ts";
import type { SessionEvent } from "../../shared/src/index.ts";
import { FakeTranscriptSource, stubAnalyzerClient } from "./test-helpers.ts";

type ServerContext = {
  baseUrl: string;
  registry: SessionRegistry;
  /** Every socket opened through this is force-closed in withServer's
   *  cleanup, so a test never has to remember to do it (or hang the process
   *  because it forgot). */
  connect: (id: string) => WebSocket;
};

async function withServer<T>(fn: (ctx: ServerContext) => Promise<T>): Promise<T> {
  const registry = new SessionRegistry({
    createTranscriptSource: () => new FakeTranscriptSource(),
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
    return await fn({ baseUrl, registry, connect });
  } finally {
    // http.Server.close() only stops accepting new connections — an
    // upgraded WS socket is still "open" from its point of view, so without
    // forcing every client shut first this callback never fires and the
    // event loop (hence `node --test`) never drains.
    for (const ws of openSockets) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postSession(baseUrl: string, body: unknown = {}): Promise<{ id: string; state: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/session`,
      { method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function collectEvents(ws: WebSocket, events: SessionEvent[]): void {
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("open", () => resolve()));
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

test("POST /session creates a session; WS drives it through consent to a risk update", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await postSession(baseUrl, { transport: "replay" });
    assert.equal(created.state, "idle");
    assert.equal(typeof created.id, "string");

    const ws = connect(created.id);
    const events: SessionEvent[] = [];
    collectEvents(ws, events);
    await opened(ws);

    // Malformed, null and oversized client data are ignored without taking
    // down the shared gateway or changing session state.
    ws.send("null");
    ws.send("x".repeat(17_000));
    ws.send(JSON.stringify({ type: "session.start" }));
    await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "awaiting-consent"));

    ws.send(JSON.stringify({ type: "consent.granted" }));
    await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "running"));

    ws.send(JSON.stringify({ type: "session.end" }));
    await waitFor(() => events.some((e) => e.type === "session.state" && e.state === "ended"));

    // seq is per-session and fanned out unchanged: every subscriber sees the
    // same contiguous 1..N sequence the Session itself produced.
    const seqs = events.map((e) => e.seq);
    const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
    assert.deepEqual(seqs, expected, "fan-out must not renumber, drop or duplicate seq");
    for (const event of events) assert.equal(event.sessionId, created.id);
  });
});

test("a late subscriber is replayed the full backlog on connect, not left blind", async () => {
  await withServer(async ({ baseUrl, connect }) => {
    const created = await postSession(baseUrl);

    const first = connect(created.id);
    await opened(first);
    first.send(JSON.stringify({ type: "session.start" }));
    first.send(JSON.stringify({ type: "consent.granted" }));

    const firstEvents: SessionEvent[] = [];
    collectEvents(first, firstEvents);
    await waitFor(() => firstEvents.some((e) => e.type === "session.state" && e.state === "running"));

    // Connects only now — after state and consent have already happened.
    const late = connect(created.id);
    const lateEvents: SessionEvent[] = [];
    collectEvents(late, lateEvents);
    await waitFor(() => lateEvents.length >= 2);

    const states = lateEvents.filter((e) => e.type === "session.state").map((e) => (e as { state: string }).state);
    assert.deepEqual(states, ["awaiting-consent", "running"], "a late subscriber must see how the session got here");

    // Otherwise this session's analyzer interval outlives the test.
    first.send(JSON.stringify({ type: "session.end" }));
    await waitFor(() => lateEvents.some((e) => e.type === "session.state" && e.state === "ended"));
  });
});

test("an unknown session id refuses the WS upgrade", async () => {
  await withServer(async ({ connect }) => {
    const ws = connect("does-not-exist");
    const outcome = await new Promise<string>((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("error"));
      ws.once("close", () => resolve("close"));
    });
    assert.notEqual(outcome, "open");
  });
});

test("a session ended and released from the registry cannot be reconnected to", async () => {
  await withServer(async ({ baseUrl, registry, connect }) => {
    const created = await postSession(baseUrl);
    const ws = connect(created.id);
    await opened(ws);
    ws.send(JSON.stringify({ type: "session.start" }));
    ws.send(JSON.stringify({ type: "consent.granted" }));
    ws.send(JSON.stringify({ type: "session.end" }));

    await waitFor(() => registry.get(created.id) === undefined);

    const reconnect = connect(created.id);
    const outcome = await new Promise<string>((resolve) => {
      reconnect.once("open", () => resolve("open"));
      reconnect.once("error", () => resolve("error"));
      reconnect.once("close", () => resolve("close"));
    });
    assert.notEqual(outcome, "open", "an ended, released session must refuse a new subscriber");
  });
});

test("an oversized HTTP body is rejected before creating a session", async () => {
  await withServer(async ({ baseUrl, registry }) => {
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: " ".repeat(4_500_001),
    });
    assert.equal(response.status, 400);
    assert.equal(registry.size, 0);
  });
});
