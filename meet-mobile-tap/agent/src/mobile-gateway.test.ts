import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { TokenVerifier } from "livekit-server-sdk";
import { requestJoinCredentials } from "../../mobile/src/gateway.ts";
import { MONITOR_IDENTITY } from "../../shared/session.ts";
import { createDemoServer, type Monitor, type MonitorOptions } from "./demo-server.ts";

const API_KEY = "mobile-integration-key";
const API_SECRET = "mobile-integration-secret-long-enough-for-hs256";
const LIVEKIT_URL = "wss://mobile-integration.invalid";
const NOW = 1_789_123_456_000;

const inertMonitor = (): Monitor => ({ stop: async () => {} });

test("mobile join uses a human identity and receives consent-bound room credentials", async () => {
  let monitorOptions: MonitorOptions | undefined;
  const app = createDemoServer({
    env: {
      LIVEKIT_URL,
      LIVEKIT_API_KEY: API_KEY,
      LIVEKIT_API_SECRET: API_SECRET,
    },
    now: () => NOW,
    startMonitor: async (options) => {
      monitorOptions = options;
      return inertMonitor();
    },
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address() as AddressInfo;

  try {
    const credentials = await requestJoinCredentials({
      gatewayUrl: `http://127.0.0.1:${address.port}`,
      roomName: "mobile-integration",
      displayName: "Ana Mobile",
    });

    assert.equal(credentials.url, LIVEKIT_URL);
    assert.equal(credentials.roomName, "mobile-integration");
    assert.equal(credentials.monitorIdentity, MONITOR_IDENTITY);
    assert.match(credentials.identity, /^mobile-[a-z0-9-]+$/);
    assert.doesNotMatch(credentials.identity, /^xentinela-/);
    assert.equal(monitorOptions?.roomName, "mobile-integration");

    const claims = await new TokenVerifier(API_KEY, API_SECRET).verify(credentials.token);
    assert.equal(claims.sub, credentials.identity);
    assert.equal(claims.name, "Ana Mobile");
    assert.equal(claims.video?.room, "mobile-integration");
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.canPublish, true);
    assert.equal(claims.video?.canSubscribe, true);

    const metadata = JSON.parse(claims.metadata ?? "") as Record<string, unknown>;
    assert.deepEqual(metadata, {
      role: "subject",
      displayName: "Ana Mobile",
      consent: true,
      consentedAt: NOW,
    });
  } finally {
    await app.stop();
  }
});
