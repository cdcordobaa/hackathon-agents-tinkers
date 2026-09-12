/**
 * The wire protocol between the gateway and the phone. One session, one
 * append-only event stream, server -> client; a small message set, client ->
 * server. Both sides are a discriminated union on `type` so a switch over it
 * is exhaustive and an unrecognised event (a future addition one side has not
 * shipped yet) can be ignored by construction rather than by convention.
 *
 * Session lifecycle: idle -> awaiting-consent -> running -> ending -> ended.
 * A session never re-enters a state it has left. `transport` names which
 * TranscriptSourceKind the session is running on.
 */
import type { SpeakerRole } from "./speaker.ts";
import type { RiskProfile } from "./risk.ts";
import type { TranscriptSourceKind } from "./transcript-source.ts";

export type SessionState = "idle" | "awaiting-consent" | "running" | "ending" | "ended";

/**
 * Fields every server -> client event carries. `seq` increments by exactly 1
 * per session with no gaps — a client resuming with `subscribe { sinceSeq }`
 * uses that to detect a hole in the backlog. `atMs` is the session clock
 * (milliseconds since the session's transcript opened), not wall-clock time.
 */
export type SessionEventEnvelope = {
  sessionId: string;
  seq: number;
  atMs: number;
};

export type SessionStateEvent = SessionEventEnvelope & {
  type: "session.state";
  state: SessionState;
  transport: TranscriptSourceKind;
};

/** One finalised turn. Mirrors RollingTranscript.final()'s rule one level up:
 *  this event exists only for finals — there is no wire event for in-progress
 *  speech, so a client cannot accidentally render text the transcript itself
 *  would later discard. */
export type TranscriptTurnEvent = SessionEventEnvelope & {
  type: "transcript.turn";
  speakerId: string;
  speakerLabel: string;
  role: SpeakerRole;
  text: string;
};

/** One progressive-analysis pass landed. `pass` and `latencyMs` are
 *  PassMeta's own fields (agent/src/analyzer.ts) surfaced as-is, so a HUD can
 *  show pass cadence without the gateway inventing a second meaning for them. */
export type RiskUpdatedEvent = SessionEventEnvelope & {
  type: "risk.updated";
  profile: RiskProfile;
  pass: number;
  latencyMs: number;
};

/** Transcription stalled or dropped for one speaker. Named `transcript.*`
 *  rather than `audio.*` on purpose: this scope has no audio path to be
 *  silent on — the failure this reports is Twilio's transcription callback
 *  going quiet or degraded for that leg, not a signal level. */
export type TranscriptDegradedEvent = SessionEventEnvelope & {
  type: "transcript.degraded";
  speakerId: string;
  reason: string;
};

export type ErrorEvent = SessionEventEnvelope & {
  type: "error";
  message: string;
};

export type SessionEvent =
  | SessionStateEvent
  | TranscriptTurnEvent
  | RiskUpdatedEvent
  | TranscriptDegradedEvent
  | ErrorEvent;

/**
 * Client -> server. These ride the same connection a session was opened on;
 * there is no session id on the message because the connection already picks
 * out the session ("Phone -> gateway WebSocket -> session", one session per
 * socket in this scope).
 */
export type ClientMessage =
  | { type: "session.start"; transport: TranscriptSourceKind }
  | { type: "session.end" }
  | { type: "consent.granted" }
  | { type: "consent.declined" }
  /** Omit `sinceSeq` on first connect; supply the last `seq` seen to resume
   *  after a reconnect. The server replies either with every event after it,
   *  in order, or an explicit signal that the backlog is gone — this union
   *  does not model that reply because it is server -> client and belongs
   *  with SessionEvent once that scenario is implemented. */
  | { type: "subscribe"; sinceSeq?: number };
