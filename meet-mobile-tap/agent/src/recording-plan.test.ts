import assert from "node:assert/strict";
import { test } from "node:test";
import { planRecordings, RECORDING_GAP_MS } from "../../shared/recording-plan.ts";

test("separate voices play in role order without overlapping", () => {
  const plan = planRecordings({ counterparty: 13_557.5, subject: 7_523.25 });
  assert.deepEqual(plan.map((cue) => cue.role), ["counterparty", "subject"]);
  assert.equal(plan[0]!.offsetMs, 0);
  assert.equal(plan[1]!.offsetMs, plan[0]!.durationMs + RECORDING_GAP_MS);
  assert.equal(plan[1]!.offsetMs + plan[1]!.durationMs, 21_530.75);
});

test("empty, invalid and overly long recordings cannot be scheduled", () => {
  for (const duration of [0, -1, NaN, Infinity, 120_001]) {
    assert.throws(() => planRecordings({ counterparty: duration, subject: 1_000 }));
    assert.throws(() => planRecordings({ counterparty: 1_000, subject: duration }));
  }
});
