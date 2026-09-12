/**
 * Pure event application for one gateway session, kept separate from the
 * WebSocket plumbing (client.ts) so the one part worth getting right —
 * sequence-gap detection, per-speaker degraded/recovery tracking, never
 * latching a score — is a plain function testable with node:test and no
 * React Native runtime.
 *
 * Every type here comes from shared/ (see ../../../shared/README.md); this
 * file defines no shape of its own that shared/ already owns.
 */
import type {
  RiskProfile,
  SessionEvent,
  SessionState,
  SpeakerRole,
  TranscriptSourceKind,
} from "../../../shared/src";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type TranscriptTurn = {
  seq: number;
  atMs: number;
  speakerId: string;
  speakerLabel: string;
  role: SpeakerRole;
  text: string;
};

export type DegradedSpeaker = {
  speakerId: string;
  reason: string;
  atMs: number;
};

export type GatewayState = {
  /** Undefined until the gateway's `POST /session` response names it — this
   *  build's gateway (server/src/gateway.ts) mints the id server-side and
   *  refuses a WebSocket upgrade to any id it does not already know about,
   *  so the client cannot pick its own. See client.ts's `start()`. */
  sessionId: string | undefined;
  connection: ConnectionStatus;
  /** True once a resumed connection's replay had a hole in `seq` —
   *  shared/src/events.ts documents `seq` as the client's own way to detect
   *  this; there is no separate wire event for it. Persists for the rest of
   *  the session once true: a gap that happened is never un-true. */
  backlogGap: boolean;
  sessionState: SessionState;
  transport: TranscriptSourceKind | undefined;
  lastSeq: number | undefined;
  profile: RiskProfile | undefined;
  /** Highest-scoring profile seen this session, kept for the post-call
   *  summary ("highest risk reached") — deliberately separate from
   *  `profile`, which is always the LATEST assessment and can fall when a
   *  pass lowers the score (see RiskBand.tsx: nothing here latches at a
   *  max, but the summary still needs to say what the peak was). */
  peak: RiskProfile | undefined;
  lastPass: { pass: number; latencyMs: number } | undefined;
  turns: TranscriptTurn[];
  /** Keyed by speakerId. A speaker is cleared from here the moment any final
   *  turn from them arrives — the wire event carries no explicit "recovered"
   *  flag, so recovery is inferred behaviourally: transcription that is
   *  actually stalled cannot also be producing turns. */
  degraded: Record<string, DegradedSpeaker>;
  lastError: string | undefined;
};

export function initialGatewayState(): GatewayState {
  return {
    sessionId: undefined,
    connection: "idle",
    backlogGap: false,
    sessionState: "idle",
    transport: undefined,
    lastSeq: undefined,
    profile: undefined,
    peak: undefined,
    lastPass: undefined,
    turns: [],
    degraded: {},
    lastError: undefined,
  };
}

export function setConnection(state: GatewayState, connection: ConnectionStatus): GatewayState {
  if (state.connection === connection) return state;
  return { ...state, connection };
}

/** Set once, right after `POST /session` resolves — see client.ts. */
export function setSessionId(state: GatewayState, sessionId: string): GatewayState {
  if (state.sessionId === sessionId) return state;
  return { ...state, sessionId };
}

/**
 * True once a session has passed the consent gate. The state machine
 * (server/src/session.ts's `TRANSITIONS` table) has no path to "running",
 * "ending" or "ended" that does not go through "awaiting-consent" ->
 * "running" first — `declineConsent` goes straight to "ended" instead, so
 * "ended" alone is ambiguous (declined OR completed) and is deliberately
 * NOT included here: a joined session already "ended" gets routed to the
 * summary screen by App.tsx, never straight to the call screen, so this
 * function is never asked about it.
 *
 * Used to route a `join`ed session straight to the call screen instead of a
 * consent screen it does not need, and to know when to say so rather than
 * silently behaving as if consent had never come up.
 */
export function hasPassedConsent(sessionState: SessionState): boolean {
  return sessionState === "running" || sessionState === "ending";
}

/**
 * Folds one SessionEvent into state. Every event is a discriminated union on
 * `type`, so an event type this client does not recognise yet falls through
 * the switch untouched — shared/'s own contract for that ("the client
 * ignores it and continues") — except for the sequence bookkeeping every
 * event carries via SessionEventEnvelope, which applies regardless of type.
 *
 * Idempotent by construction: per the call-session spec's "a late subscriber
 * is not left blind", this build's gateway replays a session's FULL event
 * log from seq 1 on every new WebSocket connection, reconnect included — not
 * only in response to an explicit `subscribe`. So an event this client has
 * already applied (`event.seq <= state.lastSeq`) is expected traffic after a
 * reconnect, not corruption, and is skipped rather than re-applied — the
 * alternative is a duplicated transcript turn for every turn spoken before
 * the drop.
 */
export function applyEvent(state: GatewayState, event: SessionEvent): GatewayState {
  if (state.lastSeq !== undefined && event.seq <= state.lastSeq) {
    return state;
  }

  const gap = state.lastSeq !== undefined && event.seq !== state.lastSeq + 1;
  let next: GatewayState = {
    ...state,
    lastSeq: event.seq,
    backlogGap: state.backlogGap || gap,
  };

  switch (event.type) {
    case "session.state": {
      next = { ...next, sessionState: event.state, transport: event.transport };
      break;
    }
    case "transcript.turn": {
      const turn: TranscriptTurn = {
        seq: event.seq,
        atMs: event.atMs,
        speakerId: event.speakerId,
        speakerLabel: event.speakerLabel,
        role: event.role,
        text: event.text,
      };
      const degraded = { ...next.degraded };
      delete degraded[event.speakerId];
      next = { ...next, turns: [...next.turns, turn], degraded };
      break;
    }
    case "risk.updated": {
      const peak = !next.peak || event.profile.score >= next.peak.score ? event.profile : next.peak;
      next = {
        ...next,
        profile: event.profile,
        peak,
        lastPass: { pass: event.pass, latencyMs: event.latencyMs },
      };
      break;
    }
    case "transcript.degraded": {
      next = {
        ...next,
        degraded: {
          ...next.degraded,
          [event.speakerId]: { speakerId: event.speakerId, reason: event.reason, atMs: event.atMs },
        },
      };
      break;
    }
    case "error": {
      next = { ...next, lastError: event.message };
      break;
    }
    default: {
      // Unknown future event type: sequence bookkeeping above already ran,
      // nothing else to do — this is the "ignore and continue" scenario.
      break;
    }
  }

  return next;
}
