import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplaySource } from "./replay-source.ts";
import type { ScriptedTurn } from "../../agent/src/fixtures/bank-scam.ts";
import type { Speaker, TranscriptSegment, TranscriptSourceStopReason } from "../../shared/src/index.ts";

// Small and fast: real BANK_SCAM sums to ~35s of gapMs, which even at a high
// speed multiplier is more wall-clock than a unit test should spend.
const SHORT_SCRIPT: ScriptedTurn[] = [
  { speaker: "caller", text: "hola", gapMs: 10 },
  { speaker: "you", text: "quien habla", gapMs: 10 },
  { speaker: "caller", text: "del banco", gapMs: 10 },
];

test("replay emits every turn, in order, as final segments", async () => {
  const source = new ReplaySource(SHORT_SCRIPT, 20); // ~1.5ms of wall time
  const segments: TranscriptSegment[] = [];
  const ended: TranscriptSourceStopReason[] = [];
  source.onSegment((s) => segments.push(s));
  source.onEnded((r) => ended.push(r));

  source.start({ sessionId: "t1", startedAt: Date.now() });
  await new Promise<void>((resolve) => source.onEnded(() => resolve()));

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((s) => s.text),
    ["hola", "quien habla", "del banco"],
  );
  assert.ok(segments.every((s) => s.isFinal));
  assert.deepEqual(ended, ["call-ended"]);
});

test("replay announces each speaker once, with a stable role", async () => {
  const source = new ReplaySource(SHORT_SCRIPT, 20);
  const speakers: Speaker[] = [];
  source.onSpeaker((s) => speakers.push(s));

  source.start({ sessionId: "t2", startedAt: Date.now() });
  await new Promise<void>((resolve) => source.onEnded(() => resolve()));

  assert.equal(speakers.length, 2, "caller and you, each announced once");
  const you = speakers.find((s) => s.id === "you");
  const caller = speakers.find((s) => s.id === "caller");
  assert.equal(you?.role, "subject");
  assert.equal(caller?.role, "counterparty");
});

test("stop() before the script finishes cancels remaining turns and is idempotent", async () => {
  const source = new ReplaySource(SHORT_SCRIPT, 1); // slow enough to interrupt
  const segments: TranscriptSegment[] = [];
  const ended: TranscriptSourceStopReason[] = [];
  source.onSegment((s) => segments.push(s));
  source.onEnded((r) => ended.push(r));

  source.start({ sessionId: "t3", startedAt: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 15)); // only the first turn should have fired
  source.stop("call-ended");
  source.stop("call-ended"); // must be safe to call twice

  const countAfterStop = segments.length;
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(segments.length, countAfterStop, "no further turns after stop()");
  assert.deepEqual(ended, ["call-ended"]);
});

test("each segment carries a unique providerEventKey and an ascending sequence", async () => {
  const source = new ReplaySource(SHORT_SCRIPT, 20);
  const segments: TranscriptSegment[] = [];
  source.onSegment((s) => segments.push(s));

  source.start({ sessionId: "t4", startedAt: Date.now() });
  await new Promise<void>((resolve) => source.onEnded(() => resolve()));

  const keys = new Set(segments.map((s) => s.providerEventKey));
  assert.equal(keys.size, segments.length);
  assert.deepEqual(
    segments.map((s) => s.sequence),
    [0, 1, 2],
  );
});
