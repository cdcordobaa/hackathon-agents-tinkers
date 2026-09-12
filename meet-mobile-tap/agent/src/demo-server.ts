import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { MONITOR_IDENTITY } from "../../shared/session.ts";

export type Monitor = { stop(): Promise<void> };
export type MonitorOptions = {
  url: string; apiKey: string; apiSecret: string; roomName: string;
  onLog?: (message: string) => void;
};
type DemoServerOptions = {
  env?: NodeJS.ProcessEnv;
  startMonitor?: (options: MonitorOptions) => Promise<Monitor>;
  onLog?: (message: string) => void;
  /** Replaced in tests; active rooms are reclaimed when all humans leave. */
  hasHumans?: (roomName: string) => Promise<boolean>;
  now?: () => number;
};

type JoinRequest = {
  roomName: string; identity: string; displayName: string;
  role: "subject" | "counterparty"; consent: true;
};

function parseJoin(value: unknown): JoinRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.consent !== true || typeof v.role !== "string" || !["subject", "counterparty"].includes(v.role)) return null;
  if (typeof v.roomName !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(v.roomName)) return null;
  if (typeof v.identity !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(v.identity) ||
    v.identity.startsWith("secureguia-")) return null;
  if (typeof v.displayName !== "string" || !v.displayName.trim() ||
    v.displayName.length > 80 || /[\x00-\x1f\x7f]/.test(v.displayName)) return null;
  return { ...v, displayName: v.displayName.trim() } as JoinRequest;
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new Error("Send JSON with Content-Type application/json.");
  }
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 4096) throw new Error("Request is too large.");
  }
  try { return JSON.parse(body); } catch { throw new Error("Invalid JSON."); }
}

/** Local development gateway. Use only on a trusted network; it is not a public auth service. */
export function createDemoServer(options: DemoServerOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const log = options.onLog ?? (() => {});
  const url = env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = env.LIVEKIT_API_KEY?.trim() ?? "";
  const apiSecret = env.LIVEKIT_API_SECRET?.trim() ?? "";
  const livekitConfigured = Boolean(/^wss?:\/\//.test(url) && apiKey && apiSecret);
  const gemini = Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  const analysisConfigured = env.ANALYSIS_PROVIDER === "gemini" ? gemini :
    env.ANALYSIS_PROVIDER === "openai" ? Boolean(env.OPENAI_API_KEY) : Boolean(env.OPENAI_API_KEY) || gemini;
  const rooms = new Map<string, { monitor: Promise<Monitor>; joinedAt: number }>();
  const rateLimits = new Map<string, { count: number; started: number }>();
  const startMonitor = options.startMonitor ?? (async (configuration) => {
    const { createLiveKitMonitor } = await import("./livekit-monitor.ts");
    return createLiveKitMonitor(configuration);
  });
  const roomService = livekitConfigured ?
    new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret) : null;
  const hasHumans = options.hasHumans ?? (async (roomName) => {
    const participants = await roomService!.listParticipants(roomName);
    return participants.some((p) => p.identity !== MONITOR_IDENTITY);
  });
  let closing = false;
  let sweeping = false;

  async function sweep() {
    if (sweeping || closing) return;
    sweeping = true;
    try {
      for (const [roomName, entry] of rooms) {
        if (now() - entry.joinedAt < 90_000) continue;
        try {
          if (await hasHumans(roomName)) continue;
          // A join may have arrived during the service request.
          if (now() - entry.joinedAt < 90_000) continue;
          rooms.delete(roomName);
          await (await entry.monitor).stop();
          log(`Released empty room ${roomName}.`);
        } catch { /* A service outage must not destroy a running session. */ }
      }
      for (const [address, entry] of rateLimits) {
        if (now() - entry.started > 60_000) rateLimits.delete(address);
      }
    } finally { sweeping = false; }
  }
  const cleanup = setInterval(() => void sweep(), 30_000);
  cleanup.unref();

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, { error: "The gateway could not complete this request." });
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const origin = request.headers.origin;
    if (origin) {
      const allowed = [`http://${request.headers.host}`, `https://${request.headers.host}`,
        ...(env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
      if (!allowed.includes(origin)) return json(response, 403, { error: "This origin is not allowed." });
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    if (request.method === "GET" && path === "/api/health") {
      return json(response, 200, { livekitConfigured, analysisConfigured,
        transcriptionConfigured: gemini, activeRooms: rooms.size });
    }
    if (request.method === "POST" && path === "/api/join") {
      const address = request.socket.remoteAddress ?? "unknown";
      const limit = rateLimits.get(address);
      if (limit && now() - limit.started < 60_000 && limit.count >= 20) {
        return json(response, 429, { error: "Too many join attempts. Please wait a minute." });
      }
      rateLimits.set(address, limit && now() - limit.started < 60_000 ?
        { ...limit, count: limit.count + 1 } : { count: 1, started: now() });
      let body: unknown;
      try { body = await jsonBody(request); }
      catch (cause) { return json(response, 400, { error: (cause as Error).message }); }
      const join = parseJoin(body);
      if (!join) return json(response, 400, {
        error: "Enter a room, name and role, and accept transcription consent before joining. Use letters, numbers, hyphens or underscores for the room and identity.",
      });
      if (!livekitConfigured) return json(response, 503, {
        error: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in agent/.env, then restart the gateway. Demo preview is available without credentials.",
      });
      if (closing) return json(response, 503, { error: "The gateway is shutting down." });
      let room = rooms.get(join.roomName);
      if (!room) {
        if (rooms.size >= 3) return json(response, 429, { error: "This demo supports three rooms. End an existing call and wait for it to close." });
        const monitor = startMonitor({ url, apiKey, apiSecret, roomName: join.roomName, onLog: log });
        room = { monitor, joinedAt: now() };
        rooms.set(join.roomName, room);
        void monitor.catch(() => {
          if (rooms.get(join.roomName)?.monitor === monitor) rooms.delete(join.roomName);
        });
      }
      room.joinedAt = now();
      try { await room.monitor; }
      catch { return json(response, 502, { error: "The monitoring participant could not connect to LiveKit. Check the project URL and credentials, then retry." }); }
      const token = new AccessToken(apiKey, apiSecret, {
        identity: join.identity, name: join.displayName, ttl: "30m",
        metadata: JSON.stringify({ role: join.role, displayName: join.displayName,
          consent: true, consentedAt: now() }),
      });
      token.addGrant({ room: join.roomName, roomJoin: true, canPublish: true,
        canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
      return json(response, 200, { url, token: await token.toJwt(), roomName: join.roomName,
        identity: join.identity, monitorIdentity: MONITOR_IDENTITY });
    }
    if (request.method === "GET") {
      const files: Record<string, [string, string]> = {
        "/": ["../web/index.html", "text/html; charset=utf-8"],
        "/index.html": ["../web/index.html", "text/html; charset=utf-8"],
        "/styles.css": ["../web/styles.css", "text/css; charset=utf-8"],
        "/app.js": ["../dist/web/app.js", "text/javascript; charset=utf-8"],
      };
      const file = files[path];
      if (file) {
        try {
          // Paths are a fixed allowlist; never interpolate a request path into the filesystem.
          const content = await readFile(new URL(file[0], import.meta.url));
          response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
          response.end(content); return;
        } catch { return json(response, 503, { error: "Browser assets are missing. Run npm run build:web." }); }
      }
    }
    return json(response, 404, { error: "Not found." });
  }

  async function stop() {
    if (closing) return;
    closing = true;
    clearInterval(cleanup);
    await Promise.allSettled([...rooms.values()].map(async (entry) => (await entry.monitor).stop()));
    rooms.clear();
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  }
  server.on("close", () => clearInterval(cleanup));
  return { server, stop, sweep };
}
