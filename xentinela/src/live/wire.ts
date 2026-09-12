/**
 * The gateway's wire protocol, as this app needs to read it.
 *
 * The definitions live in `meet-mobile-tap/shared/src/events.ts` and
 * `meet-mobile-tap/agent/src/risk-profile.ts`. They are restated here rather
 * than imported because Metro only watches this project's own root, and
 * reaching two directories up to a sibling package is exactly the kind of
 * native-adjacent build configuration that would cost us Expo Go. Keep this file in
 * lockstep with those two; it is a copy, and a copy drifts if nobody looks.
 */

export type RiskLevel = "none" | "low" | "elevated" | "high";

export type Signal = {
  /** Short slug for the tactic — "urgency", "authority-claim", "credential-request". */
  type: string;
  /** Verbatim quote from the transcript, so a finding can be checked. */
  quote: string;
  why: string;
};

export type RiskProfile = {
  risk: RiskLevel;
  /** 0-100. Not monotonic: a good explanation is allowed to lower it. */
  score: number;
  headline: string;
  signals: Signal[];
  advice: string;
  changed: string;
};

export type SessionState = "idle" | "awaiting-consent" | "running" | "ending" | "ended";
export type TranscriptSourceKind = "twilio" | "replay" | "livekit";
export type SpeakerRole = "subject" | "counterparty";

type Envelope = { sessionId: string; seq: number; atMs: number };

export type SessionEvent =
  | (Envelope & { type: "session.state"; state: SessionState; transport: TranscriptSourceKind })
  | (Envelope & {
      type: "transcript.turn";
      speakerId: string;
      speakerLabel: string;
      role: SpeakerRole;
      text: string;
    })
  | (Envelope & { type: "risk.updated"; profile: RiskProfile; pass: number; latencyMs: number })
  | (Envelope & { type: "transcript.degraded"; speakerId: string; reason: string })
  | (Envelope & { type: "error"; message: string });

export type ClientMessage =
  | { type: "session.start"; transport: TranscriptSourceKind }
  | { type: "session.end" }
  | { type: "consent.granted" }
  | { type: "consent.declined" }
  | { type: "subscribe"; sinceSeq?: number };

/** Xentinela speaks in verdicts, the analyzer in risk levels. One mapping, here,
 *  so the screens and the store never disagree about what "elevated" looks like. */
export function verdictFor(risk: RiskLevel): "safe" | "flagged" | "blocked" {
  if (risk === "high") return "blocked";
  if (risk === "elevated") return "flagged";
  return "safe";
}
