import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { RollingTranscript } from "./transcript.ts";
import { ProgressiveAnalyzer } from "./analyzer.ts";
import type { RiskProfile } from "./risk-profile.ts";

const PROFILE: RiskProfile = {
  risk: "low",
  score: 12,
  headline: "Nothing unusual yet.",
  signals: [],
  advice: "",
  changed: "First assessment.",
};

/**
 * Stands in for the OpenAI client. Records every call and lets a test hold a
 * pass open, which is how the no-overlap rule gets exercised.
 */
function stubClient() {
  const calls: string[] = [];
  let held: Promise<void> | undefined;
  let release: (() => void) | undefined;

  const client = {
    chat: {
      completions: {
        create: async (body: { messages: { content: string }[] }) => {
          calls.push(body.messages.at(-1)?.content ?? "");
          const gate = held;
          held = undefined;
          if (gate) await gate;
          return { choices: [{ message: { content: JSON.stringify(PROFILE) } }] };
        },
      },
    },
  };

  return {
    client: client as unknown as OpenAI,
    calls,
    hold: () => {
      held = new Promise<void>((resolve) => (release = resolve));
    },
    releaseHold: () => release?.(),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("flush does nothing when the transcript is empty", async () => {
  const stub = stubClient();
  const analyzer = new ProgressiveAnalyzer({
    transcript: new RollingTranscript(),
    client: stub.client,
    onResult: () => {},
  });

  await analyzer.flush();
  assert.equal(stub.calls.length, 0, "must not spend a call on an empty call");
});

test("flush analyses and reports", async () => {
  const stub = stubClient();
  const transcript = new RollingTranscript();
  const results: RiskProfile[] = [];

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: stub.client,
    onResult: (profile) => results.push(profile),
  });

  transcript.final("caller", "buenas tardes");
  await analyzer.flush();

  assert.equal(stub.calls.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 12);
  assert.match(stub.calls[0] ?? "", /buenas tardes/);
});

test("a pass marks the transcript analysed, so the next tick is skipped", async () => {
  const stub = stubClient();
  const transcript = new RollingTranscript();

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: stub.client,
    onResult: () => {},
  });

  transcript.final("caller", "one");
  await analyzer.flush();
  assert.equal(transcript.pendingSegments, 0);

  // No new speech since. A forced pass still runs (end-of-call), but the
  // interval path must not.
  assert.equal(stub.calls.length, 1);
});

test("the previous assessment is carried into the next prompt", async () => {
  const stub = stubClient();
  const transcript = new RollingTranscript();

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: stub.client,
    onResult: () => {},
  });

  transcript.final("caller", "first turn");
  await analyzer.flush();
  transcript.final("you", "second turn");
  await analyzer.flush();

  assert.equal(stub.calls.length, 2);
  assert.match(stub.calls[0] ?? "", /first pass/i);
  assert.match(stub.calls[1] ?? "", /Previous assessment: risk=low score=12/);
});

test("periodic ticks are dropped while a pass is running", async () => {
  const stub = stubClient();
  const transcript = new RollingTranscript();

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: stub.client,
    intervalMs: 5,
    onResult: () => {},
  });

  transcript.final("caller", "one");
  stub.hold();
  analyzer.start();
  await new Promise((resolve) => setTimeout(resolve, 15));

  // While that one is still in flight, more speech arrives and another pass
  // is attempted by the interval. It must be dropped.
  transcript.final("caller", "two");
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(stub.calls.length, 1, "overlapping interval passes should have been dropped");

  analyzer.stop();
  stub.releaseHold();
  await tick();
});

test("flush waits for an active pass and then forces the final pass", async () => {
  const stub = stubClient();
  const transcript = new RollingTranscript();
  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: stub.client,
    onResult: () => {},
  });

  transcript.final("caller", "one");
  stub.hold();
  const first = analyzer.flush();
  await tick();

  transcript.final("caller", "two");
  const final = analyzer.flush();
  await tick();
  assert.equal(stub.calls.length, 1, "final pass waits instead of overlapping");

  stub.releaseHold();
  await Promise.all([first, final]);

  assert.equal(stub.calls.length, 2);
  assert.match(stub.calls[1] ?? "", /two/);
});

test("a failed pass reports the error and does not wedge the analyzer", async () => {
  const transcript = new RollingTranscript();
  const errors: string[] = [];
  let attempts = 0;

  const failing = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("rate limited");
          return { choices: [{ message: { content: JSON.stringify(PROFILE) } }] };
        },
      },
    },
  } as unknown as OpenAI;

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: failing,
    onResult: () => {},
    onError: (error) => errors.push(error.message),
  });

  transcript.final("caller", "one");
  await analyzer.flush();
  assert.deepEqual(errors, ["rate limited"]);

  // The `running` guard must have been released in `finally`, or every later
  // pass is silently dropped for the rest of the call.
  transcript.final("caller", "two");
  await analyzer.flush();
  assert.equal(attempts, 2, "analyzer wedged after one failure");
});

test("empty model content is an error, not a crash", async () => {
  const transcript = new RollingTranscript();
  const errors: string[] = [];

  const empty = {
    chat: {
      completions: { create: async () => ({ choices: [{ message: { content: "" } }] }) },
    },
  } as unknown as OpenAI;

  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: empty,
    onResult: () => {},
    onError: (error) => errors.push(error.message),
  });

  transcript.final("caller", "one");
  await analyzer.flush();

  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /no content/i);
});

test("invalid risk profiles are rejected before onResult", async () => {
  const transcript = new RollingTranscript();
  const errors: string[] = [];
  let results = 0;
  const invalid = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ ...PROFILE, score: 101 }) } }],
        }),
      },
    },
  } as unknown as OpenAI;
  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: invalid,
    onResult: () => (results += 1),
    onError: (error) => errors.push(error.message),
  });

  transcript.final("caller", "one");
  await analyzer.flush();

  assert.equal(results, 0);
  assert.deepEqual(errors, ["The model returned an invalid risk profile."]);
});

test("model requests are aborted at the configured timeout", async () => {
  const transcript = new RollingTranscript();
  const errors: Error[] = [];
  const hanging = {
    chat: {
      completions: {
        create: async (_body: unknown, request: { signal: AbortSignal }) =>
          await new Promise((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), {
              once: true,
            });
          }),
      },
    },
  } as unknown as OpenAI;
  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: hanging,
    requestTimeoutMs: 5,
    onResult: () => assert.fail("a timed-out request must not publish a result"),
    onError: (error) => errors.push(error),
  });

  transcript.final("caller", "one");
  await analyzer.flush();

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.name, "TimeoutError");
});
