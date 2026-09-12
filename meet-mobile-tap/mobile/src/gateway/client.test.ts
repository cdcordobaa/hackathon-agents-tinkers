/**
 * GatewaySessionClient's `join()` path — the seam this task adds. `start()`
 * already has real network+socket plumbing that is easier to exercise by
 * hand than to usefully unit-test here; these tests stub the two things it
 * touches (`fetch`, `WebSocket`) just enough to prove the three claims that
 * matter for the live-room bug this fixes:
 *
 *   1. join() never POSTs — it is not a second way to create a session.
 *   2. a joined session already "running" never gets a consent.granted this
 *      client did not send — nothing here auto-grants on its behalf.
 *   3. a reconnect's `subscribe` carries the last seq THIS client actually
 *      saw, not a fresh one — that is what makes the reconnect a resume and
 *      not a silent rewind.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { SessionEvent } from "../../../shared/src";
import { GatewaySessionClient } from "./client";

/** Just enough of the DOM WebSocket surface for client.ts: readyState +
 *  OPEN, onopen/onmessage/onclose/onerror, send/close — plus test-only
 *  helpers (`open`, `deliver`, `remoteClose`) to drive it from the outside,
 *  since nothing in this file runs a real socket or a real gateway. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: the gateway accepted the upgrade. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: one server -> client frame arrived. */
  deliver(event: SessionEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** Test helper: the gateway (not this client) ended the connection —
   *  what a dropped network or a destroyed-on-upgrade socket looks like
   *  from here, as opposed to `disconnect()`'s own `ws.close()`. */
  remoteClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

function stateEvent(seq: number, state: "awaiting-consent" | "running" | "ending" | "ended"): SessionEvent {
  return {
    type: "session.state",
    sessionId: "s1",
    seq,
    atMs: seq * 10,
    state,
    transport: "livekit",
  };
}

/** Swaps in FakeWebSocket for the duration of `fn`, restores the previous
 *  global afterwards (there isn't one on Node, but this keeps the test
 *  self-contained regardless of run order or environment). */
async function withFakeWebSocket(fn: () => void | Promise<void>): Promise<void> {
  FakeWebSocket.instances = [];
  const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    await fn();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = previous;
  }
}

test("join() sets the session id and connects without POSTing /session", async () => {
  await withFakeWebSocket(async () => {
    let fetchCalls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.reject(new Error("join() must not call fetch"));
    }) as typeof fetch;

    try {
      const client = new GatewaySessionClient();
      client.join("browser-session-42");

      assert.equal(client.getState().sessionId, "browser-session-42");
      assert.equal(fetchCalls, 0);

      const ws = FakeWebSocket.instances[0];
      assert.ok(ws, "join() should open a WebSocket");
      assert.match(ws.url, /\/session\/browser-session-42$/);

      ws.open();
      // First connect: subscribe with no sinceSeq (per shared/src/events.ts:
      // "Omit sinceSeq on first connect"), and never session.start — the
      // browser already moved this session past idle.
      assert.deepEqual(ws.sent, [{ type: "subscribe" }]);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("a joined session already 'running' is reflected without this client ever sending consent.granted", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewaySessionClient();
    client.join("browser-session-42");

    const ws = FakeWebSocket.instances[0];
    ws.open();

    // The gateway replays the whole backlog on connect: this session was
    // already carried past awaiting-consent by whoever created it (the
    // browser) before this phone ever joined.
    ws.deliver(stateEvent(1, "awaiting-consent"));
    ws.deliver(stateEvent(2, "running"));

    assert.equal(client.getState().sessionState, "running");
    // Nothing in join()/connect() ever constructs or sends a
    // consent.granted message on this client's own initiative — only an
    // explicit grantConsent() call does, and nothing here called it.
    assert.ok(
      ws.sent.every((m) => (m as { type: string }).type !== "consent.granted"),
      `client sent consent.granted unprompted: ${JSON.stringify(ws.sent)}`,
    );
    assert.deepEqual(ws.sent, [{ type: "subscribe" }]);
  });
});

test("a reconnect's subscribe carries the last seq this client actually saw", async () => {
  await withFakeWebSocket(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const client = new GatewaySessionClient();
      client.join("browser-session-42");

      const first = FakeWebSocket.instances[0];
      first.open();
      first.deliver(stateEvent(1, "awaiting-consent"));
      first.deliver(stateEvent(2, "running"));
      assert.equal(client.getState().lastSeq, 2);

      // The network drops (or the gateway restarts) — not a user-initiated
      // disconnect(), so the client should retry against the SAME session
      // id rather than give up.
      first.remoteClose();
      assert.equal(client.getState().connection, "reconnecting");

      // First backoff delay is 1000ms (see client.ts's scheduleReconnect).
      mock.timers.tick(1000);

      const second = FakeWebSocket.instances[1];
      assert.ok(second, "a reconnect should open a second socket");
      assert.match(second.url, /\/session\/browser-session-42$/);

      second.open();
      assert.deepEqual(second.sent, [{ type: "subscribe", sinceSeq: 2 }]);
    } finally {
      mock.timers.reset();
    }
  });
});

test("join() on a session id that does not exist closes without retrying, with a visible error", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewaySessionClient();
    client.join("no-such-session");

    const ws = FakeWebSocket.instances[0];
    // This build's gateway destroys the socket on upgrade for an unknown id
    // (server/src/gateway.ts) — it never opens, never delivers a single
    // event, and then closes. That must not look like "still connecting."
    ws.remoteClose();

    assert.equal(client.getState().connection, "closed");
    assert.ok(client.getState().lastError?.includes("no-such-session"));
    assert.equal(FakeWebSocket.instances.length, 1, "must not retry a join that never delivered anything");
  });
});
