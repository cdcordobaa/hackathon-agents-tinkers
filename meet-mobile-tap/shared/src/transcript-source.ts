/**
 * The seam between a call path and the transcript. Deliberately NOT about
 * audio — this scope's transcript comes from Twilio's own real-time
 * transcription callbacks (<Start><Transcription> posting speaker-labelled
 * segments), so there is no raw audio, no mu-law decode and no in-process STT
 * anywhere behind this interface. `kind: 'twilio' | 'replay' | 'livekit'`
 * exists so a session can report which path it is on; `livekit` has no
 * transcript source in this pass (LiveKit stays a call-only rung) and is
 * listed only so the union does not need to change when it grows one.
 *
 * Twilio's callbacks are the reason every segment carries `sequence` and
 * `providerEventKey`: segments arrive OUT OF ORDER and DUPLICATED — a partial
 * can be POSTed again as a correction, and retries resend the same event.
 * `sequence` is the provider's ordering signal (use it to sort, not
 * arrival order); `providerEventKey` is the provider's own id for the event
 * and is what a consumer dedups on before ever looking at `isFinal`. A
 * `TranscriptSource` that does not carry both cannot be wired to Twilio
 * without either scrambling turn order or double-appending a final.
 */
import type { Speaker, SpeakerRole } from "./speaker.ts";

export type TranscriptSourceKind = "twilio" | "replay" | "livekit";

export type TranscriptSegment = {
  speakerId: string;
  role: SpeakerRole;
  text: string;
  /** Mirrors RollingTranscript's own rule: only a final segment is appended;
   *  a non-final replaces the previous non-final for that speaker. */
  isFinal: boolean;
  /** Provider ordering signal. Segments are not guaranteed to arrive in this
   *  order — sort by it, do not trust delivery order. */
  sequence: number;
  /** Provider's identity for this exact event. Dedup on this before doing
   *  anything else with a segment — Twilio retries resend it unchanged. */
  providerEventKey: string;
  /** Milliseconds since the session's transcript opened. */
  atMs: number;
};

export type TranscriptSourceStartContext = {
  sessionId: string;
  /** Session-clock epoch (matches RollingTranscript's `startedAt`), so a
   *  source computes `atMs` on the same clock the rest of the session uses. */
  startedAt: number;
};

export type TranscriptSourceStopReason =
  | "call-ended"
  | "consent-declined"
  | "error"
  | "replaced";

export type Unsubscribe = () => void;

export interface TranscriptSource {
  readonly kind: TranscriptSourceKind;

  start(ctx: TranscriptSourceStartContext): void | Promise<void>;
  /** MUST be safe to call twice; a second stop is a no-op, not an error —
   *  matches the conformance expectation the transport spec sets elsewhere. */
  stop(reason: TranscriptSourceStopReason): void | Promise<void>;

  onSegment(cb: (segment: TranscriptSegment) => void): Unsubscribe;
  onSpeaker(cb: (speaker: Speaker) => void): Unsubscribe;
  onEnded(cb: (reason: TranscriptSourceStopReason) => void): Unsubscribe;
}
