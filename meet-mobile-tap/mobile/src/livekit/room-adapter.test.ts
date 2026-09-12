import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptRoomSnapshot, initialRoomSession } from "../../../shared/room-session.ts";
import { MONITOR_IDENTITY, SESSION_TOPIC, type CallSnapshot } from "../../../shared/session.ts";
import { projectRoomSession } from "./room-adapter.ts";

const profile = {
  risk: "high" as const,
  score: 84,
  headline: "Caller requested a security code.",
  signals: [{ type: "credential-request", quote: "Tell me the code", why: "Codes grant access." }],
  advice: "Do not share the code.",
  changed: "Credential request detected.",
};

function snapshot(sequence: number, status: CallSnapshot["status"] = "listening"): CallSnapshot {
  return {
    version: 1,
    type: "session.snapshot",
    roomName: "mobile-room",
    sequence,
    startedAt: 1_000,
    updatedAt: 1_000 + sequence,
    status,
    detail: status === "degraded" ? "Transcription unavailable." : "Listening.",
    participants: [
      { id: "subject", name: "Ana", role: "subject", level: 0.3, hasAudio: true, consented: true },
    ],
    turns: [
      { id: "turn-1", speakerId: "subject", speakerName: "Ana", text: "Tell me the code", at: 200 },
      ...(sequence > 1
        ? [{ id: "turn-2", speakerId: "subject", speakerName: "Ana", text: "I will not.", at: 400 }]
        : []),
    ],
    profile,
  };
}

function publish(current: ReturnType<typeof initialRoomSession>, next: CallSnapshot, now: number) {
  return acceptRoomSnapshot(current, {
    payload: JSON.stringify(next),
    senderIdentity: MONITOR_IDENTITY,
    topic: SESSION_TOPIC,
    roomName: "mobile-room",
  }, now);
}

test("projects trusted room snapshots without duplicating transcript turns", () => {
  let room = publish(initialRoomSession(), snapshot(1), 10_000);
  let mobile = projectRoomSession(undefined, room, "open", 10_000);
  assert.equal(mobile.profile?.score, 84);
  assert.equal(mobile.peak?.score, 84);
  assert.deepEqual(mobile.turns.map((turn) => turn.text), ["Tell me the code"]);

  room = publish(room, snapshot(2), 11_000);
  mobile = projectRoomSession(mobile, room, "open", 11_000);
  assert.deepEqual(mobile.turns.map((turn) => turn.text), ["Tell me the code", "I will not."]);
});

test("suppresses current guidance while stale, degraded, or disconnected but retains peak", () => {
  let room = publish(initialRoomSession(), snapshot(1), 10_000);
  let mobile = projectRoomSession(undefined, room, "open", 10_000);

  mobile = projectRoomSession(mobile, room, "open", 25_001);
  assert.equal(mobile.profile, undefined);
  assert.equal(mobile.peak?.score, 84);
  assert.match(mobile.degraded.monitor?.reason ?? "", /stale/i);

  room = publish(room, snapshot(2, "degraded"), 26_000);
  mobile = projectRoomSession(mobile, room, "open", 26_000);
  assert.equal(mobile.profile, undefined);
  assert.equal(mobile.peak?.score, 84);
  assert.match(mobile.degraded.monitor?.reason ?? "", /unavailable/i);

  room = publish(initialRoomSession(), snapshot(1), 30_000);
  mobile = projectRoomSession(mobile, room, "closed", 30_000);
  assert.equal(mobile.profile, undefined);
  assert.equal(mobile.peak?.score, 84);
});

test("retains a received assessment as history even when it cannot be current", () => {
  const room = publish(initialRoomSession(), snapshot(1, "degraded"), 10_000);
  const mobile = projectRoomSession(undefined, room, "closed", 10_000);
  assert.equal(mobile.profile, undefined);
  assert.equal(mobile.peak?.score, 84);
});

test("keeps turns from a restarted monitor when its turn ids restart too", () => {
  let room = publish(initialRoomSession(), snapshot(1), 10_000);
  let mobile = projectRoomSession(undefined, room, "open", 10_000);

  const restarted = snapshot(1);
  restarted.startedAt = 2_000;
  restarted.updatedAt = 2_001;
  restarted.turns[0] = { ...restarted.turns[0], text: "A new monitor generation" };
  room = publish(room, restarted, 11_000);
  mobile = projectRoomSession(mobile, room, "open", 11_000);

  assert.deepEqual(mobile.turns.map((turn) => turn.text), [
    "Tell me the code",
    "A new monitor generation",
  ]);
});
