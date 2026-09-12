/**
 * The WebSocket half of "phone -> gateway WebSocket -> session".
 *
 * A plain class, not a hook, so the reconnect state machine is testable
 * without React and the hook (useGatewaySession.ts) is a thin
 * useSyncExternalStore wrapper around it. React Native's global `WebSocket`
 * is used as-is — no polyfill needed on this platform.
 *
 * Reconnect: on any close that this client did not request itself, retry
 * with capped exponential backoff. The first connect after `start()` sends
 * `session.start`; every connect after a drop sends `subscribe { sinceSeq }`
 * instead, resuming from the last sequence number seen. Sequence gaps from
 * that resume are detected in reducer.ts, not here — this class only owns
 * the socket lifecycle.
 */
import type { ClientMessage, TranscriptSourceKind } from "../../../shared/src";
import { buildSessionWsUrl } from "../config";
import { applyEvent, initialGatewayState, setConnection, type GatewayState } from "./reducer";

const MAX_BACKOFF_MS = 15_000;

export class GatewaySessionClient {
  private ws: WebSocket | undefined;
  private state: GatewayState;
  private readonly listeners = new Set<(state: GatewayState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByUser = false;
  private transport: TranscriptSourceKind | undefined;

  constructor(sessionId: string) {
    this.state = initialGatewayState(sessionId);
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

  /** Opens the socket and starts the session on this transport. Call once. */
  start(transport: TranscriptSourceKind): void {
    this.transport = transport;
    this.closedByUser = false;
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

  /** User-initiated teardown (leaving the call, or the app navigating away).
   *  Suppresses the reconnect loop that a server-initiated close triggers. */
  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect(): void {
    this.setState(setConnection(this.state, this.state.lastSeq === undefined ? "connecting" : "reconnecting"));

    const ws = new WebSocket(buildSessionWsUrl(this.state.sessionId));
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
      if (this.closedByUser) {
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
