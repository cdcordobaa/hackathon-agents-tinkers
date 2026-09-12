/**
 * The client half of "phone -> gateway WebSocket -> session".
 *
 * Two steps, not one: `POST /session` creates the session and hands back a
 * gateway-minted id, THEN a WebSocket connects to `/session/:id`. This
 * build's gateway (server/src/gateway.ts) destroys the socket outright on
 * upgrade if the id in the path is not already in its registry — a phone
 * cannot pick its own session id the way an earlier version of this file
 * assumed. See `start()`.
 *
 * A plain class, not a hook, so the request/reconnect state machine is
 * testable without React; the hook (useGatewaySession.ts) is a thin
 * useSyncExternalStore wrapper around it. React Native's global `fetch` and
 * `WebSocket` are used as-is — no polyfill needed on this platform.
 *
 * Reconnect: on any close this client did not request itself, retry with
 * capped exponential backoff, against the SAME session id (no new POST —
 * the session already exists server-side). Per the call-session spec ("a
 * late subscriber is not left blind"), this gateway replays a session's
 * entire event log from seq 1 on every connection, reconnect included, not
 * only in response to `subscribe`; reducer.ts's `applyEvent` is what makes
 * that safe to receive twice (already-seen `seq` is skipped, not re-applied).
 * `subscribe { sinceSeq }` is still sent on reconnect for forward
 * compatibility with a gateway that only replays on request, and is a no-op
 * against today's gateway. Once a `session.state: "ended"` has been seen,
 * the session is gone from the registry and reconnecting is pointless — the
 * close is treated as final rather than retried.
 */
import type { ClientMessage, TranscriptSourceKind } from "../../../shared/src";
import { GATEWAY_URL, buildSessionWsUrl } from "../config";
import { applyEvent, initialGatewayState, setConnection, setSessionId, type GatewayState } from "./reducer";

const MAX_BACKOFF_MS = 15_000;

export class GatewaySessionClient {
  private ws: WebSocket | undefined;
  private state: GatewayState = initialGatewayState();
  private readonly listeners = new Set<(state: GatewayState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByUser = false;
  private transport: TranscriptSourceKind | undefined;
  private readonly gatewayUrl: string;

  constructor(gatewayUrl = GATEWAY_URL) {
    this.gatewayUrl = gatewayUrl.replace(/\/+$/, "");
  }

  getState(): GatewayState {
    return this.state;
  }

  subscribe(listener: (state: GatewayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Creates the session on the gateway, then opens its socket. Call once
   *  per attempt — a fresh GatewaySessionClient is what starting over from
   *  the setup screen creates, rather than calling this twice on one. */
  async start(transport: TranscriptSourceKind): Promise<void> {
    this.transport = transport;
    this.closedByUser = false;
    this.setState(setConnection(this.state, "connecting"));

    let created: { id: string };
    try {
      const response = await fetch(`${this.gatewayUrl}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transport }),
      });
      if (!response.ok) throw new Error(`gateway refused to create a session (HTTP ${response.status})`);
      created = (await response.json()) as { id: string };
      if (!created || typeof created.id !== "string") throw new Error("gateway returned no session id");
    } catch (cause) {
      this.setState({
        ...setConnection(this.state, "closed"),
        lastError: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    // The user could decline (or navigate away) during the POST round-trip,
    // before there was ever a socket to close — without this check, the
    // connect below would open one anyway, after "decline" already told the
    // rest of the app the session was over.
    if (this.closedByUser) return;

    this.setState(setSessionId(this.state, created.id));
    this.connect();
  }

  grantConsent(): void {
    this.send({ type: "consent.granted" });
  }

  /** Per the consent requirement: declining ends the session outright, it
   *  does not just sit in awaiting-consent. */
  declineConsent(): void {
    this.send({ type: "consent.declined" });
    this.disconnect();
  }

  endSession(): void {
    this.send({ type: "session.end" });
  }

  /** Send the terminal event, then keep the socket alive briefly so the
   * server's final state/transcript events can land before teardown. */
  async endSessionAndWait(timeoutMs = 2_000): Promise<void> {
    this.endSession();
    if (this.state.sessionState === "ended") return;
    await new Promise<void>((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      unsubscribe = this.subscribe((state) => {
        if (state.sessionState === "ended" || state.connection === "closed") finish();
      });
    });
  }

  /** User-initiated teardown (leaving the call, or the app navigating away).
   *  Suppresses the reconnect loop that a server-initiated close triggers. */
  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect(): void {
    const sessionId = this.state.sessionId;
    if (!sessionId) return; // start() hasn't created the session yet

    this.setState(setConnection(this.state, this.state.lastSeq === undefined ? "connecting" : "reconnecting"));

    const ws = new WebSocket(buildSessionWsUrl(sessionId, this.gatewayUrl));
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState(setConnection(this.state, "open"));
      if (this.state.lastSeq === undefined) {
        if (this.transport) this.send({ type: "session.start", transport: this.transport });
      } else {
        this.send({ type: "subscribe", sinceSeq: this.state.lastSeq });
      }
    };

    ws.onmessage = (message: { data: unknown }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return; // malformed frame: drop it rather than crash the session
      }
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
        return;
      }
      // Cast: shape-checked above, full validation is the gateway's job —
      // an event this client doesn't recognise falls through applyEvent's
      // switch by contract (shared/src/events.ts's own documented rule).
      this.setState(applyEvent(this.state, parsed as Parameters<typeof applyEvent>[1]));
    };

    ws.onclose = () => {
      if (this.closedByUser || this.state.sessionState === "ended") {
        this.setState(setConnection(this.state, "closed"));
        return;
      }
      this.setState(setConnection(this.state, "reconnecting"));
      this.scheduleReconnect();
    };

    // onerror is always followed by onclose on RN's WebSocket; reconnect
    // logic lives there so there is exactly one path that schedules a retry.
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempt - 1), MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private setState(next: GatewayState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
