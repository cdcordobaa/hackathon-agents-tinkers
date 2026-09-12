import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEvent } from "../../../shared/src";
import { applyEvent, initialGatewayState } from "./reducer";

function stateEvent(seq: number): SessionEvent {
  return { type: "session.state", sessionId: "s1", seq, atMs: seq * 100, state: "running", transport: "replay" };
}

function turnEvent(seq: number, speakerId: string, text: string): SessionEvent {
  return {
    type: "transcript.turn",
    sessionId: "s1",
    seq,
    atMs: seq * 100,
    speakerId,
    speakerLabel: speakerId === "sub" ? "You" : "Caller",
    role: speakerId === "sub" ? "subject" : "counterparty",
    text,
  };
}

function riskEvent(seq: number, score: number): SessionEvent {
  return {
    type: "risk.updated",
    sessionId: "s1",
    seq,
    atMs: seq * 100,
    pass: 1,
    latencyMs: 1200,
    profile: {
      risk: score >= 60 ? "high" : "elevated",
      score,
      headline: "test",
      signals: [],
      advice: "",
      changed: "",
    },
  };
}

test("turns append in order and bump lastSeq", () => {
  let state = initialGatewayState();
  state = applyEvent(state, turnEvent(1, "sub", "hello"));
  state = applyEvent(state, turnEvent(2, "counterparty", "hi"));
  assert.equal(state.lastSeq, 2);
  assert.deepEqual(
    state.turns.map((t) => t.text),
    ["hello", "hi"],
  );
  assert.equal(state.backlogGap, false);
});

test("a hole in seq after a resume sets backlogGap and it stays set", () => {
  let state = initialGatewayState();
  state = applyEvent(state, stateEvent(1));
  state = applyEvent(state, stateEvent(2));
  // reconnect resumes and the gateway can only replay from seq 9 onward
  state = applyEvent(state, stateEvent(9));
  assert.equal(state.backlogGap, true);
  // a later, contiguous event does not clear it
  state = applyEvent(state, stateEvent(10));
  assert.equal(state.backlogGap, true);
});

test("risk.updated can lower the score — nothing latches it at a max", () => {
  let state = initialGatewayState();
  state = applyEvent(state, riskEvent(1, 85));
  assert.equal(state.profile?.score, 85);
  state = applyEvent(state, riskEvent(2, 20));
  assert.equal(state.profile?.score, 20);
});

test("peak tracks the highest score even after the profile falls", () => {
  let state = initialGatewayState();
  state = applyEvent(state, riskEvent(1, 85));
  state = applyEvent(state, riskEvent(2, 20));
  assert.equal(state.profile?.score, 20);
  assert.equal(state.peak?.score, 85);
});

test("a final turn from a speaker clears their degraded flag", () => {
  let state = initialGatewayState();
  state = applyEvent(state, {
    type: "transcript.degraded",
    sessionId: "s1",
    seq: 1,
    atMs: 100,
    speakerId: "counterparty",
    reason: "connection stalled",
  });
  assert.ok(state.degraded["counterparty"]);
  state = applyEvent(state, turnEvent(2, "counterparty", "back now"));
  assert.equal(state.degraded["counterparty"], undefined);
});

test("an unrecognised future event type is ignored but still advances lastSeq", () => {
  let state = initialGatewayState();
  const future = { type: "something.new", sessionId: "s1", seq: 1, atMs: 0 } as unknown as SessionEvent;
  state = applyEvent(state, future);
  assert.equal(state.lastSeq, 1);
  assert.equal(state.profile, undefined);
});
