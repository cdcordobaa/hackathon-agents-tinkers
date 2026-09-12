/**
 * Plain `node:http` + `ws`. No framework — the surface is three routes and a
 * fan-out loop, and a framework buys nothing at that size.
 *
 *   POST /session                  {transport?: TranscriptSourceKind}
 *                                   -> {id, state, token}
 *   POST /session/:id/segments      Bearer {token}, {segments: TranscriptSegment[]}
 *                                   -> 202 {accepted} | 400 | 401 | 403 | 409 | 429
 *   WS   /session/:id               subscribe to the event stream, send ClientMessages
 *
 * A WebSocket connection is not itself a subscription to nothing: the moment
 * it opens, the whole event backlog for that session is replayed to it, so a
 * client that connects after `session.state: running` still sees how it got
 * there and the latest risk profile — "a late subscriber is not left blind"
 * from the call-session spec. `{type: "subscribe", sinceSeq}` replays again
 * from a specific point, for a reconnect.
 *
 * `token` on the create response is the ingest credential a browser-rung
 * caller (see `browser-source.ts`) presents on every `/segments` POST for
 * that session, per add-browser-livekit-rung's "Segment ingestion is bound
 * to an authorised session" requirement. It is returned unconditionally
 * (every transport gets one, unused ones simply go unpresented) rather than
 * only for `transport: "livekit"`, so there is exactly one code path that
 * mints it instead of two.
 */
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { SessionRegistry } from "./session-registry.ts";
import type { ClientMessage, SessionEvent, TranscriptSourceKind } from "../../shared/src/index.ts";
import { BrowserTranscriptSource, parseSegmentBatch } from "./browser-source.ts";

const SESSION_PATH = /^\/session\/([^/]+)$/;
const SEGMENTS_PATH = /^\/session\/([^/]+)\/segments$/;
// One valid maximum-size segment batch is a little over 4 MB (200 turns at
// 20k characters plus its metadata). Keep the wire bound just above that.
const MAX_JSON_BODY_BYTES = 4_500_000;
const MAX_CLIENT_MESSAGE_BYTES = 16_384;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value;
}

function send(ws: WebSocket, event: SessionEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_JSON_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isTransportKind(value: unknown): value is TranscriptSourceKind {
  return value === "twilio" || value === "replay" || value === "livekit";
}

export type SessionHttpHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => boolean;

export type SessionWebSocketAttachment = {
  close(): Promise<void>;
};

export type SessionHttpOptions = {
  canCreateSession?: () => boolean;
  unavailableMessage?: string;
};

/** Reusable legacy-session HTTP routes for the combined call gateway. */
export function createSessionHttpHandler(
  registry: SessionRegistry,
  options: SessionHttpOptions = {},
): SessionHttpHandler {
  return (req, res) => {
    if (req.method === "POST" && req.url === "/session") {
      if (options.canCreateSession && !options.canCreateSession()) {
        sendJson(res, 503, {
          error: options.unavailableMessage ??
            "Replay sessions require risk analysis. Configure an OpenAI or Gemini model key and restart the gateway.",
        });
        return true;
      }
      readJsonBody(req)
        .then((body) => {
          const transport =
            typeof body === "object" && body !== null && "transport" in body && isTransportKind(body.transport)
              ? body.transport
              : undefined;
          const session = registry.create(transport);
          const token = registry.getIngestToken(session.id);
          sendJson(res, 201, { id: session.id, state: session.state, token });
        })
        .catch(() => {
          sendJson(res, 400, { error: "invalid request body" });
        });
      return true;
    }

    const pathname = new URL(req.url ?? "", "http://internal").pathname;
    const segmentsMatch = req.method === "POST" ? SEGMENTS_PATH.exec(pathname) : null;
    if (segmentsMatch) {
      void handleSegmentsPost(req, res, segmentsMatch[1] as string, registry);
      return true;
    }
    return false;
  };
}

/** Attach only the legacy `/session/:id` WebSocket namespace to an HTTP server. */
export function attachSessionWebSocket(
  server: http.Server,
  registry: SessionRegistry,
): SessionWebSocketAttachment {
  const wss = new WebSocketServer({ noServer: true });
  let closed = false;
  const onUpgrade = (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://internal");
    const match = SESSION_PATH.exec(url.pathname);
    const id = match?.[1];
    if (!id) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (!registry.get(id)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, id, registry);
    });
  };
  server.on("upgrade", onUpgrade);

  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      server.off("upgrade", onUpgrade);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

export function createGateway(registry: SessionRegistry): http.Server {
  const handleSessionHttp = createSessionHttpHandler(registry);
  const server = http.createServer((req, res) => {
    if (!handleSessionHttp(req, res)) sendJson(res, 404, { error: "not found" });
  });
  attachSessionWebSocket(server, registry);
  return server;
}

/**
 * The trust boundary add-browser-livekit-rung specs: a client-supplied
 * segment is untrusted input from code and a machine the gateway does not
 * control, claiming to speak for a specific session. Every check below
 * exists to make one of that spec's scenarios true; the order is not
 * arbitrary —
 *
 *   1. No credential at all -> refused BEFORE any session lookup treats the
 *      id in the URL as trustworthy ("A segment with no credential is
 *      refused").
 *   2. Credential present but wrong for this session (or the session does
 *      not exist) -> refused, nothing written, same response shape as (1)
 *      so a caller cannot use the response to enumerate valid session ids
 *      ("A segment for a session the caller does not own is refused").
 *   3. Only once the caller is proven to own this session do we say
 *      anything about the session itself (wrong transport -> 409).
 *   4. Payload shape is validated independently of all of the above —
 *      being authorised for a session buys no trust for what is inside the
 *      body ("Never let segment content influence control flow").
 *   5. Rate limiting is last and lives in `BrowserTranscriptSource` itself
 *      (one instance per session), so a runaway authorised client is still
 *      bounded.
 */
async function handleSegmentsPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  registry: SessionRegistry,
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "missing session credential" });
    return;
  }

  if (!registry.verifyIngestToken(id, token)) {
    // Deliberately identical to the "no such session" case one line below
    // this function would otherwise take: an unauthorised caller learns
    // nothing about whether the session id it guessed even exists.
    sendJson(res, 403, { error: "segment refused: not authorised for this session", accepted: 0 });
    return;
  }

  const source = registry.getTranscriptSource(id);
  if (!(source instanceof BrowserTranscriptSource)) {
    sendJson(res, 409, { error: "session is not on the browser transport", accepted: 0 });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid request body" });
    return;
  }

  const segments = parseSegmentBatch(body);
  if (!segments) {
    sendJson(res, 400, { error: "malformed segment payload" });
    return;
  }

  let accepted = 0;
  for (const segment of segments) {
    if (source.ingest(segment)) accepted += 1;
  }

  if (accepted === 0) {
    // Every segment in this batch was refused by the rate limiter (ingest()
    // only returns false post-auth for "not running" or "over the rate
    // limit" — a stopped session's route is unreachable by then since the
    // session is already released from the registry, so in practice this is
    // the rate limiter). 429 says "slow down and retry", not "malformed".
    sendJson(res, 429, { error: "rate limit exceeded for this session", accepted: 0 });
    return;
  }

  sendJson(res, 202, { accepted });
}

function handleConnection(ws: WebSocket, id: string, registry: SessionRegistry): void {
  // "current state + latest profile to a late subscriber": the full backlog
  // is a superset of that snapshot and keeps this to one code path, shared
  // with the explicit `subscribe` message below.
  for (const event of registry.eventsSince(id, 0) ?? []) send(ws, event);
  const unsubscribe = registry.subscribe(id, (event) => send(ws, event));

  ws.on("message", (raw, isBinary) => {
    const rawBytes = Array.isArray(raw)
      ? raw.reduce((total, chunk) => total + chunk.byteLength, 0)
      : raw.byteLength;
    if (isBinary || rawBytes > MAX_CLIENT_MESSAGE_BYTES) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return; // Malformed input from the client is not this session's problem.
    }
    if (!isClientMessage(parsed)) return;
    const message = parsed;

    const session = registry.get(id);
    if (!session) return;

    switch (message.type) {
      case "session.start":
        session.start();
        return;
      case "consent.granted":
        session.grantConsent();
        return;
      case "consent.declined":
        session.declineConsent();
        return;
      case "session.end":
        session.end();
        return;
      case "subscribe":
        for (const event of registry.eventsSince(id, message.sinceSeq ?? 0) ?? []) send(ws, event);
        return;
    }
  });

  ws.on("close", () => unsubscribe?.());
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "session.start" || message.type === "session.end" ||
      message.type === "consent.granted" || message.type === "consent.declined") return true;
  return message.type === "subscribe" &&
    (message.sinceSeq === undefined ||
      (typeof message.sinceSeq === "number" && Number.isSafeInteger(message.sinceSeq) && message.sinceSeq >= 0));
}
