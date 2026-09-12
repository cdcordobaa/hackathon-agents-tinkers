/** Browser-safe protocol for the LiveKit demo. Full OpenSpec event replay is deferred. */
import type { RiskProfile } from "../agent/src/risk-profile.ts";
export type { RiskProfile, RiskLevel, Signal } from "../agent/src/risk-profile.ts";

export const SESSION_TOPIC = "xentinela.session";
export const MONITOR_IDENTITY = "xentinela-monitor";

export type CallParticipant = {
  id: string;
  name: string;
  role: "subject" | "counterparty" | "unknown";
  level: number;
  hasAudio: boolean;
  consented: boolean;
};

export type CallTurn = {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  /** Milliseconds from the monitor's session start. */
  at: number;
};

export type CallSnapshot = {
  version: 1;
  type: "session.snapshot";
  roomName: string;
  sequence: number;
  /** Epoch milliseconds. */
  startedAt: number;
  updatedAt: number;
  status: "waiting" | "listening" | "analyzing" | "degraded" | "ended";
  detail: string;
  participants: CallParticipant[];
  turns: CallTurn[];
  profile: RiskProfile | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 16_000): value is string =>
  typeof value === "string" && value.length <= max;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function isRiskProfile(value: unknown): value is RiskProfile {
  return record(value) &&
    typeof value.risk === "string" && ["none", "low", "elevated", "high"].includes(value.risk) &&
    nonnegative(value.score) && Number.isInteger(value.score) && value.score <= 100 &&
    text(value.headline) && text(value.advice) && text(value.changed) &&
    Array.isArray(value.signals) && value.signals.length <= 100 &&
    value.signals.every((signal) => record(signal) &&
      text(signal.type) && text(signal.quote) && text(signal.why));
}

/** Reject malformed/oversized data before either UI renders a room publication. */
export function parseCallSnapshot(raw: unknown): CallSnapshot | null {
  let value = raw;
  if (typeof value === "string") {
    if (value.length > 200_000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!record(value) || value.version !== 1 || value.type !== "session.snapshot" ||
    !text(value.roomName, 64) || !nonnegative(value.sequence) ||
    !Number.isSafeInteger(value.sequence) || !nonnegative(value.startedAt) ||
    !nonnegative(value.updatedAt) || value.updatedAt < value.startedAt ||
    typeof value.status !== "string" || !["waiting", "listening", "analyzing", "degraded", "ended"].includes(value.status) ||
    !text(value.detail) || !Array.isArray(value.participants) || value.participants.length > 32 ||
    !Array.isArray(value.turns) || value.turns.length > 100 ||
    !(value.profile === null || isRiskProfile(value.profile))) return null;

  if (!value.participants.every((p) => record(p) && text(p.id, 128) && text(p.name, 100) &&
    typeof p.role === "string" && ["subject", "counterparty", "unknown"].includes(p.role) &&
    nonnegative(p.level) && p.level <= 1 && typeof p.hasAudio === "boolean" &&
    typeof p.consented === "boolean")) return null;
  if (!value.turns.every((t) => record(t) && text(t.id, 128) && text(t.speakerId, 128) &&
    text(t.speakerName, 100) && text(t.text) && nonnegative(t.at))) return null;

  // Object callers (including fixtures) receive the same aggregate size bound.
  if (typeof raw !== "string") {
    try { if (JSON.stringify(value).length > 200_000) return null; }
    catch { return null; }
  }
  return value as CallSnapshot;
}
