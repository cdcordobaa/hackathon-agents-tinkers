import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "./session.ts";
import type { SessionEvent, SessionState } from "../../shared/src/index.ts";
import { FakeTranscriptSource, segment, stubAnalyzerClient, tick } from "./test-helpers.ts";

function buildSession(overrides: { onEvent?: (event: SessionEvent) => void } = {}) {
  const source = new FakeTranscriptSource();
  const events: SessionEvent[] = [];
  const session = new Session({
    id: "s1",
    transportKind: "replay",
    transcriptSource: source,
    analyzer: { client: stubAnalyzerClient(), intervalMs: 60_000 },
    onEvent: (event) => {
      events.push(event);
      overrides.onEvent?.(event);
    },
  });
  return { session, source, events };
}

/** Every test that grants consent starts ProgressiveAnalyzer's interval
 *  timer — this must run before the test file ends or the process never
 *  exits, since a live setInterval keeps the event loop open. */
async function shutdown(session: Session): Promise<void> {
  session.end();
  await tick();
  await tick();
}

test("state machine: the happy path visits every state in order", async () => {
  const { session, events } = buildSession();

  assert.equal(session.state, "idle");
  session.start();
  assert.equal(session.state, "awaiting-consent");
  session.grantConsent();
  assert.equal(session.state, "running");

  const states = events.filter((e) => e.type === "session.state").map((e) => (e as { state: SessionState }).state);
  assert.deepEqual(states, ["awaiting-consent", "running"]);

  await shutdown(session);
});

test("state machine: a session cannot be started twice", async () => {
  const { session, events } = buildSession();
  session.start();
  session.grantConsent();

  const before = session.state;
  session.start(); // running -> awaiting-consent is not a legal edge

  assert.equal(session.state, before, "an illegal transition must not move the state");
  const errors = events.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);

  await shutdown(session);
});

test("state machine: consent cannot be granted twice, or before start", async () => {
  const { session: fresh, events: freshEvents } = buildSession();
  fresh.grantConsent(); // idle -> running is not a legal edge
  assert.equal(fresh.state, "idle");
  assert.equal(freshEvents.filter((e) => e.type === "error").length, 1);

  const { session, events } = buildSession();
  session.start();
  session.grantConsent();
  session.grantConsent(); // running -> running is not a legal edge
  assert.equal(session.state, "running");
  assert.equal(events.filter((e) => e.type === "error").length, 1);

  await shutdown(session);
});

test("state machine: an ended session rejects session.start and stays ended", async () => {
  const { session, events } = buildSession();
  session.start();
  session.grantConsent();
  await shutdown(session);
  assert.equal(session.state, "ended");

  events.length = 0;
  session.start();

  assert.equal(session.state, "ended", "the session must stay ended");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "error");
});

test("state machine: declining consent skips straight to ended and stops the transport, synchronously", () => {
  const { session, source } = buildSession();
  session.start();
  session.declineConsent();

  assert.equal(session.state, "ended", "no ending state — nothing was ever admitted to flush");
  assert.deepEqual(source.stopReasons, ["consent-declined"]);
});

test("state machine: end() from idle is rejected", () => {
  const { session, events } = buildSession();
  session.end();
  assert.equal(session.state, "idle");
  assert.equal(events.filter((e) => e.type === "error").length, 1);
});

test("consent gate: zero transcript writes before consent, regardless of how many segments arrive", async () => {
  const { session, source } = buildSession();
  session.start(); // awaiting-consent — the gate is up

  source.push(segment({ sequence: 0, text: "first" }));
  source.push(segment({ sequence: 1, text: "second" }));
  await tick();

  assert.equal(session.segmentCount, 0, "not one segment may reach the transcript pre-consent");
  assert.equal(session.discardedSegmentCount, 2);
  assert.equal(session.renderTranscript(), "");

  session.grantConsent();
  source.push(segment({ sequence: 2, text: "third", providerEventKey: "key-2" }));
  await tick();

  assert.equal(session.segmentCount, 1, "segments after consent must reach the transcript");

  await shutdown(session);
});

test("dedup: the same providerEventKey never produces a second transcript entry", async () => {
  const { session, source } = buildSession();
  session.start();
  session.grantConsent();

  const dup = segment({ sequence: 0, text: "hello", providerEventKey: "same-key" });
  source.push(dup);
  source.push({ ...dup }); // a distinct object, identical providerEventKey — a Twilio retry
  await tick();

  assert.equal(session.segmentCount, 1);

  // A retry that lands in a *later* burst (after the first has flushed) must
  // also be dropped — dedup is forever, not just within one flush.
  source.push({ ...dup });
  await tick();
  assert.equal(session.segmentCount, 1);

  await shutdown(session);
});

test("ordering: out-of-order segments land in sequence order, not arrival order", async () => {
  const { session, source } = buildSession();
  session.start();
  session.grantConsent();

  source.push(segment({ sequence: 2, text: "third", speakerId: "you", providerEventKey: "k2" }));
  source.push(segment({ sequence: 0, text: "first", speakerId: "you", providerEventKey: "k0" }));
  source.push(segment({ sequence: 1, text: "second", speakerId: "you", providerEventKey: "k1" }));
  await tick();

  assert.equal(session.segmentCount, 3);
  const lines = session.renderTranscript().split("\n").map((line) => line.split("] you: ")[1]);
  assert.deepEqual(lines, ["first", "second", "third"]);

  await shutdown(session);
});

test("partials never reach the transcript; only the final does", async () => {
  const { session, source } = buildSession();
  session.start();
  session.grantConsent();

  source.push(segment({ sequence: 0, text: "my name is", isFinal: false, providerEventKey: "p0" }));
  await tick();
  assert.equal(session.segmentCount, 0);

  source.push(segment({ sequence: 1, text: "my name is Ana", isFinal: true, providerEventKey: "p1" }));
  await tick();
  assert.equal(session.segmentCount, 1);

  await shutdown(session);
});

test("a transcript.turn event is emitted for every final, carrying the announced speaker", async () => {
  const { session, source, events } = buildSession();
  session.start();
  session.grantConsent();

  source.announce({ id: "caller", label: "Caller", role: "counterparty" });
  source.push(segment({ sequence: 0, text: "buenas tardes", providerEventKey: "k0" }));
  await tick();

  const turn = events.find((e) => e.type === "transcript.turn");
  assert.ok(turn);
  assert.equal((turn as { speakerLabel: string }).speakerLabel, "Caller");
  assert.equal((turn as { role: string }).role, "counterparty");

  await shutdown(session);
});

test("end() flushes a final analysis pass before reaching ended", async () => {
  const { session, source, events } = buildSession();
  session.start();
  session.grantConsent();
  source.push(segment({ sequence: 0, text: "one", providerEventKey: "k0" }));
  await tick();

  session.end();
  await tick();
  await tick(); // let the flushed analysis pass's promise resolve

  assert.equal(session.state, "ended");
  assert.ok(events.some((e) => e.type === "risk.updated"), "the end-of-call flush must produce a risk.updated");
  assert.deepEqual(source.stopReasons, ["call-ended"]);
});

test("seq increments by exactly 1 per session with no gaps, across every event type", async () => {
  const { session, source, events } = buildSession();
  session.start();
  session.grantConsent();
  source.announce({ id: "you", label: "You", role: "subject" });
  source.push(segment({ sequence: 0, text: "one", speakerId: "you", providerEventKey: "k0" }));
  await tick();
  session.end();
  await tick();
  await tick();

  assert.ok(events.length >= 4, "expected at least state/turn/risk/state events");
  const seqs = events.map((e) => e.seq);
  const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
  assert.deepEqual(seqs, expected);
  for (const event of events) assert.equal(event.sessionId, "s1");
});
