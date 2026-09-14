/**
 * Drives the gateway's session lifecycle over its existing WS protocol
 * (server/src/gateway.ts, shared/src/events.ts) — `POST /session`, then
 * `session.start` and `consent.granted` over the socket it hands back. This
 * app must push the session to `running` itself: `Session.handleSegment`
 * (server/src/session.ts) drops every segment on the floor before consent is
 * granted, by construction, so segments POSTed while still `idle` or
 * `awaiting-consent` are silently discarded — not a bug to work around here,
 * the thing the state machine is for.
 *
 * `token` on the returned handle is the ingest credential `POST /session` now mints
 * and returns unconditionally (see server/src/gateway.ts's own header) — read here and
 * forwarded as `Authorization: Bearer` in ../gateway/transcript-poster.ts. It stays
 * typed `string | undefined` defensively (a future gateway build that omits it should
 * degrade to "no header sent", per that file's own fallback, not throw here) but in
 * today's gateway it is always present.
 *
 * This app is also the only party that ever sees this response — the phone
 * (`mobile/`) never calls `POST /session` for this same call, it joins the session id
 * this app creates (see main.ts's Session panel: that id, large, copyable, and as a
 * QR code, is how it gets from this tab onto the phone).
 */
import type { ClientMessage, SessionEvent, SessionState, TranscriptSourceKind } from "../../../shared/src/index.ts";

export type SessionHandle = {
  id: string;
  token?: string;
  grantConsent: () => void;
  declineConsent: () => void;
  end: () => void;
  close: () => void;
};

export type SessionCallbacks = {
  onState: (state: SessionState) => void;
  onEvent: (event: SessionEvent) => void;
  onError: (message: string) => void;
};

export async function openGatewaySession(
  gatewayUrl: string,
  transport: TranscriptSourceKind,
  cb: SessionCallbacks,
): Promise<SessionHandle> {
  const createRes = await fetch(`${gatewayUrl}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transport }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`POST /session -> ${createRes.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const created = (await createRes.json()) as { id: string; state: SessionState; token?: string };

  const wsUrl = `${gatewayUrl.replace(/^http/, "ws")}/session/${created.id}`;
  const socket = new WebSocket(wsUrl);

  const send = (message: ClientMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  socket.addEventListener("open", () => send({ type: "session.start", transport }));

  socket.addEventListener("message", (event) => {
    let parsed: SessionEvent;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return; // Malformed frame from the gateway is not this app's problem.
    }
    cb.onEvent(parsed);
    if (parsed.type === "session.state") cb.onState(parsed.state);
    if (parsed.type === "error") cb.onError(parsed.message);
  });

  socket.addEventListener("error", () => cb.onError("gateway websocket error"));
  socket.addEventListener("close", (event) => {
    if (event.code !== 1000) cb.onError(`gateway websocket closed unexpectedly (code ${event.code})`);
  });

  return {
    id: created.id,
    token: created.token,
    grantConsent: () => send({ type: "consent.granted" }),
    declineConsent: () => send({ type: "consent.declined" }),
    end: () => send({ type: "session.end" }),
    close: () => socket.close(1000),
  };
}
