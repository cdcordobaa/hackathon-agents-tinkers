/**
 * Unit-level coverage for `BrowserTranscriptSource` itself (the
 * TranscriptSource seam and its rate limiter) and for the payload
 * validators (`parseSegment`/`parseSegmentBatch`, the trust-boundary shape
 * check). The route-level auth/ordering/dedup behaviour is covered in
 * `segments-route.test.ts` against a real HTTP server, since dedup and
 * reorder are `Session`'s job (server/src/session.ts), not this file's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserTranscriptSource, parseSegment, parseSegmentBatch, MAX_SEGMENTS_PER_REQUEST } from "./browser-source.ts";
import type { TranscriptSegment } from "../../shared/src/index.ts";

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    speakerId: "browser-1",
    role: "subject",
    text: "hello",
    isFinal: true,
    sequence: 0,
    providerEventKey: "livekit:browser-1:0",
    atMs: 0,
    ...overrides,
  };
}

test("kind is livekit — the union value shared/ reserves for this source", () => {
  const source = new BrowserTranscriptSource();
  assert.equal(source.kind, "livekit");
});

test("ingest() before start() is refused, not emitted", () => {
  const source = new BrowserTranscriptSource();
  const received: TranscriptSegment[] = [];
  source.onSegment((s) => received.push(s));

  assert.equal(source.ingest(makeSegment()), false);
  assert.deepEqual(received, []);
});

test("ingest() after start() emits through onSegment unchanged", () => {
  const source = new BrowserTranscriptSource();
  const received: TranscriptSegment[] = [];
  source.onSegment((s) => received.push(s));

  source.start({ sessionId: "s1", startedAt: 0 });
  const segment = makeSegment();
  assert.equal(source.ingest(segment), true);
  assert.deepEqual(received, [segment]);
});

test("ingest() after stop() is refused — matches every other TranscriptSource's lifecycle", () => {
  const source = new BrowserTranscriptSource();
  source.start({ sessionId: "s1", startedAt: 0 });
  source.stop("call-ended");

  assert.equal(source.ingest(makeSegment()), false);
});

test("stop() is safe to call twice and only fires onEnded once", () => {
  const source = new BrowserTranscriptSource();
  let endedCount = 0;
  source.onEnded(() => (endedCount += 1));

  source.start({ sessionId: "s1", startedAt: 0 });
  source.stop("call-ended");
  source.stop("call-ended");

  assert.equal(endedCount, 1);
});

test("rate limit: the (n+1)th ingest within a window is refused, not emitted", () => {
  let now = 1000;
  const source = new BrowserTranscriptSource({ maxSegmentsPerWindow: 3, windowMs: 1000, now: () => now });
  const received: TranscriptSegment[] = [];
  source.onSegment((s) => received.push(s));
  source.start({ sessionId: "s1", startedAt: 0 });

  const results = [0, 1, 2, 3, 4].map((i) => source.ingest(makeSegment({ sequence: i, providerEventKey: `k${i}` })));

  assert.deepEqual(results, [true, true, true, false, false], "only the first 3 in the window are accepted");
  assert.equal(received.length, 3);
  assert.equal(source.rateLimitedCount, 2);
});

test("rate limit: a new window resets the budget", () => {
  let now = 0;
  const source = new BrowserTranscriptSource({ maxSegmentsPerWindow: 1, windowMs: 100, now: () => now });
  source.start({ sessionId: "s1", startedAt: 0 });

  assert.equal(source.ingest(makeSegment({ sequence: 0, providerEventKey: "k0" })), true);
  assert.equal(source.ingest(makeSegment({ sequence: 1, providerEventKey: "k1" })), false);

  now += 101; // past the window
  assert.equal(source.ingest(makeSegment({ sequence: 2, providerEventKey: "k2" })), true, "a fresh window has budget again");
});

// ---- payload validation -----------------------------------------------------

test("parseSegment accepts a well-formed segment", () => {
  const parsed = parseSegment(makeSegment());
  assert.deepEqual(parsed, makeSegment());
});

test("parseSegment rejects non-object input", () => {
  assert.equal(parseSegment(null), undefined);
  assert.equal(parseSegment("a string"), undefined);
  assert.equal(parseSegment(42), undefined);
  assert.equal(parseSegment(undefined), undefined);
});

test("parseSegment rejects a missing field", () => {
  const { speakerId: _drop, ...rest } = makeSegment();
  assert.equal(parseSegment(rest), undefined);
});

test("parseSegment rejects an invalid role rather than guessing one", () => {
  assert.equal(parseSegment(makeSegment({ role: "fraudster" as never })), undefined);
});

test("parseSegment rejects the wrong type for isFinal, sequence and atMs", () => {
  assert.equal(parseSegment({ ...makeSegment(), isFinal: "true" as never }), undefined);
  assert.equal(parseSegment({ ...makeSegment(), sequence: "0" as never }), undefined);
  assert.equal(parseSegment({ ...makeSegment(), sequence: Number.NaN }), undefined);
  assert.equal(parseSegment({ ...makeSegment(), atMs: Number.POSITIVE_INFINITY }), undefined);
});

test("parseSegment rejects an empty or oversized providerEventKey/speakerId", () => {
  assert.equal(parseSegment(makeSegment({ providerEventKey: "" })), undefined);
  assert.equal(parseSegment(makeSegment({ speakerId: "x".repeat(10_000) })), undefined);
});

test("parseSegmentBatch rejects a body with no segments array", () => {
  assert.equal(parseSegmentBatch({}), undefined);
  assert.equal(parseSegmentBatch({ segments: "not-an-array" }), undefined);
  assert.equal(parseSegmentBatch({ segments: [] }), undefined);
  assert.equal(parseSegmentBatch(null), undefined);
});

test("parseSegmentBatch rejects the whole batch if any one segment is malformed", () => {
  const batch = { segments: [makeSegment({ sequence: 0 }), { garbage: true }] };
  assert.equal(parseSegmentBatch(batch), undefined);
});

test("parseSegmentBatch rejects a batch larger than the per-request cap", () => {
  const segments = Array.from({ length: MAX_SEGMENTS_PER_REQUEST + 1 }, (_, i) =>
    makeSegment({ sequence: i, providerEventKey: `k${i}` }),
  );
  assert.equal(parseSegmentBatch({ segments }), undefined);
});

test("parseSegmentBatch accepts a well-formed multi-segment batch, in the given order", () => {
  const segments = [makeSegment({ sequence: 0, providerEventKey: "k0" }), makeSegment({ sequence: 1, providerEventKey: "k1" })];
  assert.deepEqual(parseSegmentBatch({ segments }), segments);
});
