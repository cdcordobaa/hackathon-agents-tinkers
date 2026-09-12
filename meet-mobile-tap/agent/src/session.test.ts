import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRiskProfile,
  parseCallSnapshot,
  type CallSnapshot,
  type RiskProfile,
} from "../../shared/session.ts";

const profile: RiskProfile = {
  risk: "elevated",
  score: 61,
  headline: "Caller requested a verification code.",
  signals: [{ type: "credential-request", quote: "dime el código", why: "Requests a secret." }],
  advice: "Do not share the code.",
  changed: "A credential request raised the risk.",
};

const snapshot = (): CallSnapshot => ({
  version: 1,
  type: "session.snapshot",
  roomName: "demo-room",
  sequence: 3,
  startedAt: 1_000,
  updatedAt: 2_000,
  status: "listening",
  detail: "Receiving audio.",
  participants: [{
    id: "ana-1",
    name: "Ana",
    role: "subject",
    level: 0.42,
    hasAudio: true,
    consented: true,
  }],
  turns: [{
    id: "ana-1:1",
    speakerId: "ana-1",
    speakerName: "Ana",
    text: "Hola",
    at: 500,
  }],
  profile,
});

test("accepts valid snapshots as objects or JSON strings", () => {
  const value = snapshot();
  assert.equal(parseCallSnapshot(value), value);
  assert.deepEqual(parseCallSnapshot(JSON.stringify(value)), value);
  assert.equal(isRiskProfile(profile), true);
});

test("rejects malformed, oversized, and binary snapshot payloads", () => {
  const mutations: unknown[] = [
    null,
    [],
    "not json",
    "x".repeat(200_001),
    { ...snapshot(), turns: Array.from({ length: 20 }, () => ({ ...snapshot().turns[0]!, text: "a".repeat(16_000) })) },
    new TextEncoder().encode(JSON.stringify(snapshot())),
    { ...snapshot(), version: 2 },
    { ...snapshot(), type: "session.delta" },
    { ...snapshot(), sequence: 1.5 },
    { ...snapshot(), updatedAt: 999 },
    { ...snapshot(), status: "unknown" },
    { ...snapshot(), participants: Array.from({ length: 33 }, () => snapshot().participants[0]) },
    { ...snapshot(), turns: Array.from({ length: 101 }, () => snapshot().turns[0]) },
    { ...snapshot(), profile: { ...profile, score: 101 } },
  ];

  for (const value of mutations) assert.equal(parseCallSnapshot(value), null);
});

test("rejects malformed participant, turn, and profile fields", () => {
  const badParticipant = snapshot();
  badParticipant.participants[0] = { ...badParticipant.participants[0]!, level: -0.1 };
  assert.equal(parseCallSnapshot(badParticipant), null);

  const badRole = snapshot();
  (badRole.participants[0] as { role: string }).role = "admin";
  assert.equal(parseCallSnapshot(badRole), null);

  const badTurn = snapshot();
  (badTurn.turns[0] as { at: number }).at = Number.NaN;
  assert.equal(parseCallSnapshot(badTurn), null);

  assert.equal(isRiskProfile({ ...profile, risk: "critical" }), false);
  assert.equal(isRiskProfile({ ...profile, score: 4.2 }), false);
  assert.equal(isRiskProfile({ ...profile, signals: [{ type: "urgency", quote: "now" }] }), false);
});
