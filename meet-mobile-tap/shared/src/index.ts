/**
 * Every cross-track contract in one place. See ../README.md for who owns
 * each seam and what its fake is.
 */
export type { Speaker, SpeakerRole } from "./speaker.ts";

export type {
  SessionState,
  SessionEventEnvelope,
  SessionStateEvent,
  TranscriptTurnEvent,
  RiskUpdatedEvent,
  TranscriptDegradedEvent,
  ErrorEvent,
  SessionEvent,
  ClientMessage,
} from "./events.ts";

export type {
  TranscriptSourceKind,
  TranscriptSegment,
  TranscriptSourceStartContext,
  TranscriptSourceStopReason,
  Unsubscribe,
  TranscriptSource,
} from "./transcript-source.ts";

export { type RiskLevel, type Signal, type RiskProfile, RISK_PROFILE_SCHEMA } from "./risk.ts";
