/**
 * The phone half of the detection gateway's session protocol.
 *
 * Two steps, not one: `POST /session` creates the session and the gateway
 * mints the id, THEN a WebSocket opens on `/session/:id`. The gateway destroys
 * the upgrade outright for an id it does not already hold, so the phone cannot
 * pick its own id.
 *
 * Then the lifecycle, which is deliberately not automatic:
 *   session.start    -> idle to awaiting-consent, the transcript source starts
 *   consent.granted  -> awaiting-consent to running, the analyzer starts
 * Consent is a person's answer, so `grantConsent()` is a separate call the
 * screen makes when they press the button — never something `start()` sends on
 * their behalf.
 *
 * A plain class rather than a hook, so the connection state machine is
 * readable on its own; `useLiveCall` is a thin subscription on top.
 */
import { GATEWAY_URL, sessionSocketUrl } from "./config";
import type {
  ClientMessage,
  RiskProfile,
  SessionEvent,
  SessionState,
  SpeakerRole,
  TranscriptSourceKind,
} from "./wire";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type Turn = {
  seq: number;
  atMs: number;
  speakerId: string;
  speakerLabel: string;
  role: SpeakerRole;
  text: string;
};

export type LiveCallState = {
  sessionId?: string;
  connection: ConnectionStatus;
  sessionState: SessionState;
  transport?: TranscriptSourceKind;
  /** Last event applied. Events arrive with no gaps in `seq`; the backlog is
   *  replayed in full on every connect, so this is also the dedup key. */
  lastSeq: number;
  /** True once a replay skipped a `seq` — a hole that happened is never
   *  un-true, so this never clears. */
  backlogGap: boolean;
  /** Always the LATEST assessment. It can fall: a pass is allowed to lower a
   *  score when something is genuinely explained. */
  profile?: RiskProfile;
  /** Highest score seen. The summary needs the peak even when the call ended
   *  calm, and `profile` cannot answer that. */
  peak?: RiskProfile;
  pass?: { pass: number; latencyMs: number };
  turns: Turn[];
  /** Keyed by speaker: transcription for that leg went quiet or degraded. */
  degraded: Record<string, string>;
  /** Session clock of the last event, in ms. The call's length so far. */
  atMs: number;
  error?: string;
};

const MAX_BACKOFF_MS = 15_000;

export function initialLiveCallState(): LiveCallState {
  return {
    connection: "idle",
    sessionState: "idle",
    lastSeq: 0,
    backlogGap: false,
    turns: [],
    degraded: {},
    atMs: 0,
  };
}

export class LiveCallClient {
  private ws?: WebSocket;
  private state = initialLiveCallState();
  private readonly listeners = new Set<(state: LiveCallState) => void>();
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private closedByUser = false;
  private transport: TranscriptSourceKind = "replay";
  /** Queued until the socket is open. `session.start` is sent the moment the
   *  connection exists; consent may arrive before that and must not be lost. */
  private pending: ClientMessage[] = [];

  getState(): LiveCallState {
    return this.state;
  }

  subscribe(listener: (state: LiveCallState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Creates the session, opens its socket, and starts the transcript source.
   *  Analysis waits for `grantConsent()`. */
  async start(transport: TranscriptSourceKind = "replay"): Promise<void> {
    this.transport = transport;
    this.closedByUser = false;
    this.attempt = 0;
    this.state = { ...initialLiveCallState(), connection: "connecting" };
    this.emit();

    let id: string;
    try {
      const response = await fetch(`${GATEWAY_URL}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transport }),
      });
      if (!response.ok) {
        throw new Error(`the gateway refused to create a session (HTTP ${response.status})`);
      }
      const created = (await response.json()) as { id?: unknown };
      if (typeof created?.id !== "string") throw new Error("the gateway returned no session id");
      id = created.id;
    } catch (cause) {
      this.patch({
        connection: "closed",
        error: describe(cause, `Could not reach the gateway at ${GATEWAY_URL}.`),
      });
      return;
    }

    this.patch({ sessionId: id });
    this.pending = [{ type: "session.start", transport }];
    this.open(id);
  }

  /** The person agreed to be listened to. Until this lands, nothing reaches
   *  the transcript and no analysis runs. */
  grantConsent(): void {
    this.send({ type: "consent.granted" });
  }

  declineConsent(): void {
    this.send({ type: "consent.declined" });
  }

  /** Hang up. The session flushes and ends; the socket closes on its own. */
  end(): void {
    this.send({ type: "session.end" });
  }

  /** Stop talking to the gateway entirely, without asking the session to end
   *  — for leaving the screen. Reconnection stops here. */
  close(): void {
    this.closedByUser = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.ws?.close();
    this.ws = undefined;
    this.patch({ connection: "closed" });
  }

  // ---- connection ---------------------------------------------------------

  private open(id: string): void {
    const ws = new WebSocket(sessionSocketUrl(id));
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.patch({ connection: "open", error: undefined });
      const queued = this.pending;
      this.pending = [];
      for (const message of queued) this.write(message);
      // Forward compatibility with a gateway that replays only on request.
      // Today's gateway replays the whole log on connect, and applyEvent's
      // seq check is what makes receiving it twice harmless.
      this.write({ type: "subscribe", sinceSeq: this.state.lastSeq || undefined });
    };

    ws.onmessage = (message) => {
      let event: SessionEvent;
      try {
        event = JSON.parse(String(message.data)) as SessionEvent;
      } catch {
        return; // A malformed frame is not this screen's problem.
      }
      this.apply(event);
    };

    ws.onerror = () => {
      // `onclose` always follows, and that is where reconnection is decided.
      // The event itself carries nothing worth showing a person.
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      // Once the session has ended it is gone from the gateway's registry, so
      // reconnecting would only be refused.
      if (this.closedByUser || this.state.sessionState === "ended") {
        this.patch({ connection: "closed" });
        return;
      }
      this.patch({ connection: "reconnecting" });
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
      this.attempt += 1;
      this.retry = setTimeout(() => {
        if (this.closedByUser || !this.state.sessionId) return;
        this.open(this.state.sessionId);
      }, delay);
    };
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) this.write(message);
    else this.pending.push(message);
  }

  private write(message: ClientMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  // ---- events -------------------------------------------------------------

  private apply(event: SessionEvent): void {
    if (event.seq <= this.state.lastSeq) return; // Replayed; already applied.
    const next: LiveCallState = {
      ...this.state,
      lastSeq: event.seq,
      backlogGap: this.state.backlogGap || event.seq > this.state.lastSeq + 1,
      atMs: Math.max(this.state.atMs, event.atMs),
    };

    switch (event.type) {
      case "session.state":
        next.sessionState = event.state;
        next.transport = event.transport;
        break;
      case "transcript.turn":
        next.turns = [
          ...this.state.turns,
          {
            seq: event.seq,
            atMs: event.atMs,
            speakerId: event.speakerId,
            speakerLabel: event.speakerLabel,
            role: event.role,
            text: event.text,
          },
        ];
        // A final turn for a speaker is proof that leg is being heard again.
        if (this.state.degraded[event.speakerId]) {
          const { [event.speakerId]: _cleared, ...rest } = this.state.degraded;
          next.degraded = rest;
        }
        break;
      case "risk.updated":
        next.profile = event.profile;
        next.peak =
          !this.state.peak || event.profile.score > this.state.peak.score
            ? event.profile
            : this.state.peak;
        next.pass = { pass: event.pass, latencyMs: event.latencyMs };
        break;
      case "transcript.degraded":
        next.degraded = { ...this.state.degraded, [event.speakerId]: event.reason };
        break;
      case "error":
        next.error = event.message;
        break;
    }

    this.state = next;
    this.emit();
  }

  private patch(partial: Partial<LiveCallState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

function describe(cause: unknown, prefix: string): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `${prefix} ${detail}`;
}
