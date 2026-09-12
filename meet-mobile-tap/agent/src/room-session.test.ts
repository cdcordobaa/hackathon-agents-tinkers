import { test } from "node:test";
import assert from "node:assert/strict";
import { MONITOR_IDENTITY, SESSION_TOPIC, type CallSnapshot } from "../../shared/session.ts";
import {
  acceptRoomSnapshot, currentRoomProfile, initialRoomSession, ROOM_STALE_AFTER_MS,
  type RoomPublication,
} from "../../shared/room-session.ts";

function snapshot(overrides: Partial<CallSnapshot> = {}): CallSnapshot {
  return {
    version: 1, type: "session.snapshot", roomName: "shared-call", sequence: 10,
    startedAt: 100, updatedAt: 500, status: "listening", detail: "Receiving audio.",
    participants: [{ id: "phone", name: "Ana", role: "subject", level: 0.5, hasAudio: true, consented: true }],
    turns: [{ id: "turn-1", speakerId: "phone", speakerName: "Ana", text: "¿Por qué necesita mi código?", at: 200 }],
    profile: { risk: "high", score: 87, headline: "Request for a secret", signals: [], advice: "Keep the code private.", changed: "Code requested." },
    ...overrides,
  };
}

function publication(value = snapshot(), overrides: Partial<RoomPublication> = {}): RoomPublication {
  return {
    payload: new TextEncoder().encode(JSON.stringify(value)),
    senderIdentity: MONITOR_IDENTITY, topic: SESSION_TOPIC, roomName: "shared-call", ...overrides,
  };
}

test("browser and native clients converge on the same transcript and risk after a packet gap", () => {
  let browser = initialRoomSession();
  let native = initialRoomSession();
  browser = acceptRoomSnapshot(browser, publication(), 1_000);
  native = acceptRoomSnapshot(native, publication(), 1_010);
  const next = snapshot({ sequence: 13, updatedAt: 900, profile: { ...snapshot().profile!, risk: "low", score: 18 } });
  browser = acceptRoomSnapshot(browser, publication(next), 2_000);
  native = acceptRoomSnapshot(native, publication(next, { payload: JSON.stringify(next) }), 2_010);
  assert.deepEqual(browser.snapshot, native.snapshot);
  assert.deepEqual(currentRoomProfile(browser, 2_020), currentRoomProfile(native, 2_020));
  assert.equal(currentRoomProfile(native, 2_020)?.score, 18);
  assert.equal(native.snapshot?.turns[0]?.text, "¿Por qué necesita mi código?");
});

test("untrusted, wrong-room, malformed and oversized data cannot change state or refresh its age", () => {
  const state = acceptRoomSnapshot(initialRoomSession(), publication(), 1_000);
  const badPackets = [
    publication(snapshot({ sequence: 11 }), { senderIdentity: "counterparty" }),
    publication(snapshot({ sequence: 11 }), { senderIdentity: undefined }),
    publication(snapshot({ sequence: 11 }), { topic: undefined }),
    publication(snapshot({ sequence: 11 }), { topic: "other" }),
    publication(snapshot({ roomName: "someone-else", sequence: 11 })),
    publication(snapshot(), { payload: "not JSON" }),
    publication(snapshot(), { payload: new Uint8Array(200_001) }),
    publication(snapshot({ sequence: 11, profile: { ...snapshot().profile!, score: 101 } })),
  ];
  for (const packet of badPackets) assert.equal(acceptRoomSnapshot(state, packet, 2_000), state);
});

test("duplicate and reordered packets never refresh stale guidance", () => {
  const state = acceptRoomSnapshot(initialRoomSession(), publication(), 1_000);
  assert.equal(acceptRoomSnapshot(state, publication(), 20_000), state);
  assert.equal(acceptRoomSnapshot(state, publication(snapshot({ sequence: 9 })), 20_000), state);
  assert.equal(acceptRoomSnapshot(state, publication(snapshot({ sequence: 11, updatedAt: 499 })), 20_000), state);
  assert.equal(currentRoomProfile(state, 20_000), null);
  assert.equal(state.receivedAt, 1_000);
});

test("freshness uses local receipt time, hides old guidance, and recovers on a new packet", () => {
  const state = acceptRoomSnapshot(initialRoomSession(), publication(), 0);
  assert.equal(currentRoomProfile(state, ROOM_STALE_AFTER_MS)?.score, 87);
  assert.equal(currentRoomProfile(state, ROOM_STALE_AFTER_MS + 1), null);
  assert.equal(currentRoomProfile(state, -1), null);
  const recovered = acceptRoomSnapshot(state, publication(snapshot({ sequence: 11 })), 20_000);
  assert.equal(currentRoomProfile(recovered, 20_001)?.score, 87);
});

test("waiting, degraded and ended snapshots never present an attached profile as current", () => {
  for (const status of ["waiting", "degraded", "ended"] as const) {
    const state = acceptRoomSnapshot(initialRoomSession(), publication(snapshot({ status })), 1_000);
    assert.equal(currentRoomProfile(state, 1_001), null);
  }
  assert.equal(currentRoomProfile(initialRoomSession()), null);
  const analyzing = acceptRoomSnapshot(initialRoomSession(), publication(snapshot({ status: "analyzing" })), 1_000);
  assert.equal(currentRoomProfile(analyzing, 1_001)?.score, 87);
});

test("monitor restart accepts a new sequence and rejects late packets from the previous instance", () => {
  const state = acceptRoomSnapshot(initialRoomSession(), publication(), 1_000);
  const restarted = acceptRoomSnapshot(state, publication(snapshot({ startedAt: 2_000, updatedAt: 2_000, sequence: 1, profile: null, turns: [] })), 3_000);
  assert.equal(restarted.snapshot?.sequence, 1);
  assert.equal(restarted.snapshot?.turns.length, 0);
  assert.equal(currentRoomProfile(restarted, 3_001), null);
  assert.equal(acceptRoomSnapshot(restarted, publication(snapshot({ sequence: 99, updatedAt: 2_500 })), 4_000), restarted);
});

test("ended monitor generation cannot resume itself but a new call can replace it", () => {
  const ended = acceptRoomSnapshot(initialRoomSession(), publication(snapshot({ status: "ended" })), 1_000);
  assert.equal(acceptRoomSnapshot(ended, publication(snapshot({ sequence: 11 })), 2_000), ended);
  const next = acceptRoomSnapshot(ended, publication(snapshot({ startedAt: 2_000, updatedAt: 2_000, sequence: 0 })), 3_000);
  assert.notEqual(next, ended);
});
