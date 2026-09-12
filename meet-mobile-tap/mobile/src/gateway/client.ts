/**
 * The client half of "phone -> gateway WebSocket -> session".
 *
 * Two ways to attach to a session, not one:
 *
 *   - `start(transport)` — POSTs `/session` to CREATE one, then connects and
 *     sends `session.start`. This is the phone driving its own call (Twilio,
 *     replay, or a phone-only LiveKit room).
 *   - `join(sessionId)` — connects straight to an id someone else's
 *     `POST /session` already minted (the browser rung, see web/src/main.ts)
 *     and never sends `session.start`. The session's state machine
 *     (server/src/session.ts) only allows `idle -> awaiting-consent` once;
 *     a second `session.start` on an already-started session is an illegal
 *     transition the server rejects with an `error` event rather than a
 *     crash — but "rejected silently" is still the wrong outcome, so `join`
 *     simply never sends it. This is the seam that lets a browser hold the
 *     one thing only it has (the ingest token from its own `POST /session`
 *     response) while the phone still watches the same live session.
 *
 * Either way, this build's gateway (server/src/gateway.ts) destroys the
 * socket outright on upgrade if the id in the path is not already in its
 * registry — a phone cannot pick its own session id, it can only join one
 * that already exists.
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
 * `subscribe { sinceSeq }` is still sent on reconnect (and, for `join`, on
 * the very first connect too — see `connect()`) for forward compatibility
 * with a gateway that only replays on request, and is a no-op against
 * today's gateway, which always replays the full backlog unconditionally on
 * connect. Once a `session.state: "ended"` has been seen, the session is
 * gone from the registry and reconnecting is pointless — the close is
 * treated as final rather than retried.
 *
 * One more honest-failure case only `join` can hit: a bad/typo'd/already-
 * ended session id. The gateway destroys the socket on upgrade for those
 * with no message at all, so a `join`ed socket that closes having never
 * delivered a single replayed event is not a transient drop worth retrying
 * — it is "this id does not exist," and retrying forever would sit in
 * `connecting` looking exactly like a slow network, which is the specific
 * kind of silent-not-working this project cares about avoiding. See
 * `connect()`'s `onclose`.
 */
import type { ClientMessage, TranscriptSourceKind } from "../../../shared/src";
import { GATEWAY_URL, buildSessionWsUrl } from "../config";
import { applyEvent, initialGatewayState, setConnection, setSessionId, type GatewayState } from "./reducer";

const MAX_BACKOFF_MS = 15_000;

export class GatewaySessionClient {
  private ws: WebSocket | undefined;
  private state: GatewayState;
  private readonly listeners = new Set<(state: GatewayState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByUser = false;
  private transport: TranscriptSourceKind | undefined;
  /** "start": this client created the session and owns sending
   *  `session.start`. "join": this client attached to a session someone else
   *  created and must never send `session.start` — see the file header. */
  private mode: "start" | "join" = "start";

  constructor() {
    this.state = initialGatewayState();
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
    this.mode = "start";
    this.transport = transport;
    this.closedByUser = false;
    this.setState(setConnection(this.state, "connecting"));

    let created: { id: string };
    try {
      const response = await fetch(`${GATEWAY_URL}/session`, {
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

  /** Attaches to a session someone else's `POST /session` already created —
   *  the browser rung, in the live-room demo. SKIPS the create call entirely
   *  (no fetch, no new session) and connects the WebSocket straight to
   *  `/session/:id`. `connect()` sends `subscribe` rather than
   *  `session.start` on open for a `join`ed client — see the file header for
   *  why sending `session.start` here would be a bug, not a formality: the
   *  session is already past `idle` and the state machine's transition
   *  table (server/src/session.ts) does not allow re-entering it.
   *
   *  Synchronous (no network round-trip needed before the id is known) —
   *  returns void rather than a Promise so callers do not need to `await` a
   *  join the way they `await start()`'s POST. */
  join(sessionId: string): void {
    this.mode = "join";
    this.transport = undefined;
    this.closedByUser = false;
    this.setState(setConnection(this.state, "connecting"));
    this.setState(setSessionId(this.state, sessionId));
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
    const sessionId = this.state.sessionId;
    if (!sessionId) return; // start() hasn't created the session yet

    this.setState(setConnection(this.state, this.state.lastSeq === undefined ? "connecting" : "reconnecting"));

    const ws = new WebSocket(buildSessionWsUrl(sessionId));
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState(setConnection(this.state, "open"));
      if (this.mode === "join") {
        // Never session.start — see the file header and join()'s own doc.
        // `sinceSeq` is omitted on this client's very first connect
        // (`lastSeq` still undefined) per shared/src/events.ts's documented
        // `subscribe` contract, and carries the last-seen seq on a
        // reconnect, same as the "start" branch below.
        this.send({ type: "subscribe", sinceSeq: this.state.lastSeq });
      } else if (this.state.lastSeq === undefined) {
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
      if (this.mode === "join" && this.state.lastSeq === undefined) {
        // A joined socket that closed having never delivered a single
        // replayed event isn't a dropped connection worth retrying — this
        // build's gateway destroys the socket outright on upgrade for an id
        // it does not recognise (server/src/gateway.ts), so this is "no
        // such session," not "network blip." Looping reconnect attempts here
        // would sit in "connecting" forever and look exactly like a slow
        // network — the specific silent-failure shape this project cares
        // about surfacing instead. See the file header.
        this.setState({
          ...setConnection(this.state, "closed"),
          lastError: `could not join session "${sessionId}" — check the id, or it may have already ended`,
        });
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
