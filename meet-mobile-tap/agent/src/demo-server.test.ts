import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { TokenVerifier } from "livekit-server-sdk";
import { createDemoServer, type Monitor } from "./demo-server.ts";
import { MONITOR_IDENTITY } from "../../shared/session.ts";

const API_KEY = "test-api-key";
const API_SECRET = "test-secret-that-is-long-enough-for-hs256";
const LIVEKIT_URL = "wss://unit-test.invalid";

const configuredEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  LIVEKIT_URL,
  LIVEKIT_API_KEY: API_KEY,
  LIVEKIT_API_SECRET: API_SECRET,
  ...extra,
});

const validJoin = {
  roomName: "demo-room",
  identity: "ana-1",
  displayName: "Ana",
  role: "subject",
  consent: true,
} as const;

async function withServer<T>(
  options: Parameters<typeof createDemoServer>[0],
  run: (baseUrl: string, app: ReturnType<typeof createDemoServer>) => Promise<T>,
): Promise<T> {
  const app = createDemoServer(options);
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`, app);
  } finally {
    await app.stop();
  }
}

async function postJoin(baseUrl: string, body: unknown, origin?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

const inertMonitor = (): Monitor => ({ stop: async () => {} });

test("health reports configuration capabilities without returning credentials", async () => {
  await withServer(
    { env: configuredEnv({ OPENAI_API_KEY: "private-openai-key" }), startMonitor: async () => inertMonitor() },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        livekitConfigured: true,
        analysisConfigured: true,
        transcriptionConfigured: false,
        activeRooms: 0,
      });
      const raw = await (await fetch(`${baseUrl}/api/health`)).text();
      assert.doesNotMatch(raw, /private-openai-key|test-secret|test-api-key/);
    },
  );
});

test("join rejects absent consent before starting a monitor", async () => {
  let starts = 0;
  await withServer(
    {
      env: configuredEnv(),
      startMonitor: async () => {
        starts += 1;
        return inertMonitor();
      },
    },
    async (baseUrl) => {
      const response = await postJoin(baseUrl, { ...validJoin, consent: false });
      assert.equal(response.status, 400);
      assert.match(JSON.stringify(await response.json()), /consent/i);
      assert.equal(starts, 0);
    },
  );
});

test("valid join returns a JWT scoped to the room, role, and immutable consent metadata", async () => {
  await withServer(
    { env: configuredEnv(), startMonitor: async () => inertMonitor() },
    async (baseUrl) => {
      const response = await postJoin(baseUrl, validJoin);
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.url, LIVEKIT_URL);
      assert.equal(body.roomName, validJoin.roomName);
      assert.equal(body.identity, validJoin.identity);
      assert.equal(body.monitorIdentity, MONITOR_IDENTITY);

      const claims = await new TokenVerifier(API_KEY, API_SECRET).verify(String(body.token));
      assert.equal(claims.sub, validJoin.identity);
      assert.equal(claims.name, validJoin.displayName);
      assert.deepEqual(claims.video, {
        room: validJoin.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: false,
      });
      const metadata = JSON.parse(claims.metadata ?? "") as Record<string, unknown>;
      assert.equal(metadata.role, "subject");
      assert.equal(metadata.displayName, validJoin.displayName);
      assert.equal(metadata.consent, true);
      assert.equal(typeof metadata.consentedAt, "number");
    },
  );
});

test("concurrent joins to one room share a single monitor startup", async () => {
  let starts = 0;
  let release!: (monitor: Monitor) => void;
  const monitorReady = new Promise<Monitor>((resolve) => (release = resolve));
  await withServer(
    {
      env: configuredEnv(),
      startMonitor: async () => {
        starts += 1;
        return monitorReady;
      },
    },
    async (baseUrl) => {
      const first = postJoin(baseUrl, validJoin);
      const second = postJoin(baseUrl, {
        ...validJoin,
        identity: "bank-1",
        displayName: "Banco",
        role: "counterparty",
      });
      for (let attempt = 0; attempt < 50 && starts === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      // Give the second request time to reach the room map while startup stays pending.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const startsWhileBothPending = starts;
      release(inertMonitor());
      const responses = await Promise.all([first, second]);
      assert.deepEqual(responses.map((response) => response.status), [200, 200]);
      assert.equal(startsWhileBothPending, 1);
      assert.equal(starts, 1);
    },
  );
});

test("reserved SecureGuIA identities cannot request human join tokens", async () => {
  let starts = 0;
  await withServer(
    {
      env: configuredEnv(),
      startMonitor: async () => {
        starts += 1;
        return inertMonitor();
      },
    },
    async (baseUrl) => {
      for (const identity of [MONITOR_IDENTITY, "secureguia-admin"]) {
        const response = await postJoin(baseUrl, { ...validJoin, identity });
        assert.equal(response.status, 400);
      }
      assert.equal(starts, 0);
    },
  );
});

test("cross-origin requests are rejected before gateway work", async () => {
  let starts = 0;
  await withServer(
    {
      env: configuredEnv(),
      startMonitor: async () => {
        starts += 1;
        return inertMonitor();
      },
    },
    async (baseUrl) => {
      const response = await postJoin(baseUrl, validJoin, "https://attacker.invalid");
      assert.equal(response.status, 403);
      assert.match(JSON.stringify(await response.json()), /origin/i);
      assert.equal(starts, 0);
    },
  );
});

test("a failed monitor startup is removed so a later join can retry", async () => {
  let starts = 0;
  await withServer(
    {
      env: configuredEnv(),
      startMonitor: async () => {
        starts += 1;
        if (starts === 1) throw new Error("provider details must stay private");
        return inertMonitor();
      },
    },
    async (baseUrl) => {
      const failed = await postJoin(baseUrl, validJoin);
      assert.equal(failed.status, 502);
      assert.doesNotMatch(await failed.text(), /provider details must stay private/);

      const retried = await postJoin(baseUrl, validJoin);
      assert.equal(retried.status, 200);
      assert.equal(starts, 2);
    },
  );
});

test("sweep stops and removes a room after humans have been absent for 90 seconds", async () => {
  let now = 1_000;
  let stops = 0;
  const logs: string[] = [];
  await withServer(
    {
      env: configuredEnv(),
      now: () => now,
      hasHumans: async () => false,
      onLog: (message) => logs.push(message),
      startMonitor: async () => ({ stop: async () => { stops += 1; } }),
    },
    async (baseUrl, app) => {
      assert.equal((await postJoin(baseUrl, validJoin)).status, 200);
      now += 90_001;
      await app.sweep();
      assert.equal(stops, 1);
      assert.deepEqual(logs, [`Released empty room ${validJoin.roomName}.`]);
      const health = await (await fetch(`${baseUrl}/api/health`)).json() as { activeRooms: number };
      assert.equal(health.activeRooms, 0);
    },
  );
});
