import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewaySessionClient } from "./client.ts";

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | undefined;

  readyState = 0;
  sent: string[] = [];
  closes = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.latest = this;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.closes += 1;
    this.readyState = 3;
    this.onclose?.();
  }
}

test("session ending waits for the terminal event before socket teardown", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "mobile-session" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new GatewaySessionClient("http://gateway.test:8787");
    await client.start("replay");
    const socket = FakeWebSocket.latest;
    assert.ok(socket);
    socket.open();

    const ending = client.endSessionAndWait(1_000);
    assert.deepEqual(socket.sent.map((message) => JSON.parse(message)), [
      { type: "session.start", transport: "replay" },
      { type: "session.end" },
    ]);
    assert.equal(socket.closes, 0);

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session.state",
        sessionId: "mobile-session",
        seq: 1,
        atMs: 100,
        state: "ended",
        transport: "replay",
      }),
    });
    await ending;
    assert.equal(client.getState().sessionState, "ended");
    assert.equal(socket.closes, 0, "the final event arrives while the socket remains open");

    client.disconnect();
    assert.equal(socket.closes, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    FakeWebSocket.latest = undefined;
  }
});
