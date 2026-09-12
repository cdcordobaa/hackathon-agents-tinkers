import { test } from "node:test";
import assert from "node:assert/strict";
import { RollingTranscript, formatClock } from "./transcript.ts";

/** A clock we control, so the timestamps in assertions are not wall-clock. */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test("only finals reach the transcript", () => {
  const clock = fakeClock();
  const transcript = new RollingTranscript(clock.now);

  transcript.delta("caller", "my name is");
  assert.equal(transcript.render(), "");
  assert.equal(transcript.segmentCount, 0);

  transcript.final("caller", "my name is Ana from the bank");
  assert.equal(transcript.render(), "[00:00] caller: my name is Ana from the bank");
});

test("a delta replaces rather than appends", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  transcript.delta("caller", "I need your");
  transcript.delta("caller", "I need your card number");
  assert.equal(transcript.inFlight.get("caller"), "I need your card number");
});

test("finalising clears the in-flight line for that speaker only", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  transcript.delta("caller", "hold on");
  transcript.delta("you", "who is this");
  transcript.final("caller", "hold on please");

  assert.equal(transcript.inFlight.has("caller"), false);
  assert.equal(transcript.inFlight.get("you"), "who is this");
});

test("empty and whitespace finals are dropped", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  transcript.final("caller", "   ");
  transcript.final("caller", "");
  assert.equal(transcript.segmentCount, 0);
});

test("pendingSegments drives skip-if-unchanged", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  assert.equal(transcript.pendingSegments, 0);

  transcript.final("caller", "one");
  transcript.final("you", "two");
  assert.equal(transcript.pendingSegments, 2);

  transcript.markAnalyzed();
  assert.equal(transcript.pendingSegments, 0);

  transcript.final("caller", "three");
  assert.equal(transcript.pendingSegments, 1);
});

test("renderPending returns only unanalysed turns", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  transcript.final("caller", "one");
  transcript.markAnalyzed();
  transcript.final("you", "two");

  assert.equal(transcript.renderPending(), "[00:00] you: two");
});

test("timestamps advance with the clock", () => {
  const clock = fakeClock();
  const transcript = new RollingTranscript(clock.now);

  transcript.final("caller", "first");
  clock.advance(75_000);
  transcript.final("you", "later");

  assert.equal(
    transcript.render(),
    "[00:00] caller: first\n[01:15] you: later",
  );
});

test("render keeps head and tail when over budget, and never splits a line", () => {
  const clock = fakeClock();
  const transcript = new RollingTranscript(clock.now);

  transcript.final("caller", "OPENING-PRETEXT");
  for (let i = 0; i < 200; i++) {
    clock.advance(1000);
    transcript.final("caller", `filler line number ${i}`);
  }
  transcript.final("you", "CLOSING-LINE");

  const out = transcript.render({ maxChars: 600 });

  assert.ok(out.length <= 600, `expected <= 600 chars, got ${out.length}`);
  assert.ok(out.includes("OPENING-PRETEXT"), "must keep the start of the call");
  assert.ok(out.includes("CLOSING-LINE"), "must keep the most recent turn");
  assert.ok(out.includes("trimmed"), "must mark the elision");

  // Every surviving line is whole: it starts with a [mm:ss] stamp.
  for (const line of out.split("\n")) {
    if (!line || line.startsWith("[...")) continue;
    assert.match(line, /^\[\d{2}:\d{2}\] /, `line was split mid-way: ${JSON.stringify(line)}`);
  }
});

test("render under budget is untouched", () => {
  const transcript = new RollingTranscript(fakeClock().now);
  transcript.final("caller", "short");
  assert.equal(transcript.render({ maxChars: 10_000 }), "[00:00] caller: short");
});

test("formatClock pads and rolls over minutes", () => {
  assert.equal(formatClock(0), "[00:00]");
  assert.equal(formatClock(9_000), "[00:09]");
  assert.equal(formatClock(61_000), "[01:01]");
  assert.equal(formatClock(-5), "[00:00]");
});
