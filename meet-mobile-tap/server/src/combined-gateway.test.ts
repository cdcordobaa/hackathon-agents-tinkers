import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createDemoServer } from "../../agent/src/demo-server.ts";
import { createSessionExtension, createSessionRuntime, type SessionRuntime } from "./main.ts";
import { SessionRegistry } from "./session-registry.ts";
import { ReplaySource } from "./replay-source.ts";
import { stubAnalyzerClient } from "./test-helpers.ts";
import type { SessionEvent } from "../../shared/src/index.ts";

test("one HTTP server serves the call UI, LiveKit join, and consented replay session", async () => {
  const registry = new SessionRegistry({
    createTranscriptSource: () => new ReplaySource([
      { speaker: "caller", text: "Necesito confirmar su código.", gapMs: 20 },
    ], 20),
    analyzer: { client: stubAnalyzerClient(), intervalMs: 60_000 },
  });
  let monitorStarts = 0;
  const app = createDemoServer({
    env: {
      LIVEKIT_URL: "wss://unit-test.invalid",
      LIVEKIT_API_KEY: "test-api-key",
      LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-for-hs256",
    },
    startMonitor: async () => {
      monitorStarts += 1;
      return { stop: async () => {} };
    },
    extension: createSessionExtension({
      registry,
      analysisConfigured: true,
      modelDescription: "offline test",
      defaultTransport: "replay",
    }),
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let socket: WebSocket | undefined;

  try {
    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /SecureGuIA/i);

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { livekitConfigured: boolean }).livekitConfigured, true);

    const joined = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: "combined-room",
        identity: "combined-subject",
        displayName: "Ana",
        role: "subject",
        consent: true,
      }),
    });
    assert.equal(joined.status, 200);
    assert.equal(monitorStarts, 1);

    const created = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transport: "replay" }),
    });
    assert.equal(created.status, 201);
    const session = await created.json() as { id: string; state: string; token: string };
    assert.equal(session.state, "idle");
    assert.ok(session.id);
    assert.ok(session.token);

    socket = new WebSocket(`ws://127.0.0.1:${address.port}/session/${session.id}`);
    const events: SessionEvent[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Replay session did not end.")), 2_000);
      socket!.on("message", (raw) => {
        const event = JSON.parse(raw.toString()) as SessionEvent;
        events.push(event);
        if (event.type === "session.state" && event.state === "ended") {
          clearTimeout(timeout);
          resolve();
        }
      });
      socket!.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      socket!.once("open", resolve);
      socket!.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "session.start" }));
    socket.send(JSON.stringify({ type: "consent.granted" }));
    await ended;

    assert.ok(events.some((event) =>
      event.type === "session.state" && event.state === "running"));
    assert.ok(events.some((event) =>
      event.type === "transcript.turn" && event.text === "Necesito confirmar su código."));
    assert.ok(events.some((event) => event.type === "risk.updated"));
  } finally {
    socket?.terminate();
    await app.stop();
  }
});

test("no-key boot keeps the call gateway healthy and rejects replay explicitly", async () => {
  const runtime = createSessionRuntime({});
  const app = createDemoServer({ env: {}, extension: createSessionExtension(runtime) });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { analysisConfigured: boolean }).analysisConfigured, false);

    const replay = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(replay.status, 503);
    assert.match(await replay.text(), /OPENAI_API_KEY|GEMINI_API_KEY/);
    assert.equal(runtime.registry.size, 0);
  } finally {
    await app.stop();
  }
});

test("gateway shutdown aborts an active replay and clears its timers without analysis", async () => {
  const calls: unknown[] = [];
  const registry = new SessionRegistry({
    createTranscriptSource: () => new ReplaySource([
      { speaker: "caller", text: "This must never be emitted after shutdown.", gapMs: 100 },
    ]),
    analyzer: {
      client: {
        chat: { completions: { create: async (...args: unknown[]) => {
          calls.push(args);
          throw new Error("model should not be called");
        } } },
      } as never,
      intervalMs: 60_000,
    },
  });
  const runtime: SessionRuntime = {
    registry,
    analysisConfigured: true,
    modelDescription: "offline test",
    defaultTransport: "replay",
  };
  const app = createDemoServer({ env: {}, extension: createSessionExtension(runtime) });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address() as AddressInfo;
  const created = await fetch(`http://127.0.0.1:${address.port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transport: "replay" }),
  });
  const session = await created.json() as { id: string };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/session/${session.id}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "session.start" }));
  socket.send(JSON.stringify({ type: "consent.granted" }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  await app.stop();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(registry.size, 0);
  assert.equal(calls.length, 0);
});
