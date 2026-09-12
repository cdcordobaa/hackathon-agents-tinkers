/**
 * Plain `node:http` + `ws`. No framework — the surface is two routes and a
 * fan-out loop, and a framework buys nothing at that size.
 *
 *   POST /session          {transport?: TranscriptSourceKind} -> {id, state}
 *   WS   /session/:id       subscribe to the event stream, send ClientMessages
 *
 * A WebSocket connection is not itself a subscription to nothing: the moment
 * it opens, the whole event backlog for that session is replayed to it, so a
 * client that connects after `session.state: running` still sees how it got
 * there and the latest risk profile — "a late subscriber is not left blind"
 * from the call-session spec. `{type: "subscribe", sinceSeq}` replays again
 * from a specific point, for a reconnect.
 */
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { SessionRegistry } from "./session-registry.ts";
import type { ClientMessage, SessionEvent, TranscriptSourceKind } from "../../shared/src/index.ts";

const SESSION_PATH = /^\/session\/([^/]+)$/;

function send(ws: WebSocket, event: SessionEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isTransportKind(value: unknown): value is TranscriptSourceKind {
  return value === "twilio" || value === "replay" || value === "livekit";
}

export function createGateway(registry: SessionRegistry): http.Server {
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/session") {
      readJsonBody(req)
        .then((body) => {
          const transport =
            typeof body === "object" && body !== null && "transport" in body && isTransportKind(body.transport)
              ? body.transport
              : undefined;
          const session = registry.create(transport);
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: session.id, state: session.state }));
        })
        .catch(() => {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid request body" }));
        });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://internal");
    const match = SESSION_PATH.exec(url.pathname);
    const id = match?.[1];
    if (!id || !registry.get(id)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, id, registry);
    });
  });

  return server;
}

function handleConnection(ws: WebSocket, id: string, registry: SessionRegistry): void {
  // "current state + latest profile to a late subscriber": the full backlog
  // is a superset of that snapshot and keeps this to one code path, shared
  // with the explicit `subscribe` message below.
  for (const event of registry.eventsSince(id, 0) ?? []) send(ws, event);
  const unsubscribe = registry.subscribe(id, (event) => send(ws, event));

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // Malformed input from the client is not this session's problem.
    }

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
