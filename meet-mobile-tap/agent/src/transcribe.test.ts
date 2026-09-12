import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribeChunk, TranscriptionError, TranscriptionFailures, transcriptionTimeoutMs } from "./transcribe.ts";

const audio = new Int16Array(480);
const options = { apiKey: "test-private-key", model: "gemini-2.5-flash", retryDelayMs: 1 };
const response = (text: string) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] });

test("transcription sends PCM with credentials in a header and disables default Flash reasoning", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, request: RequestInit) => {
    assert.ok(!url.includes(options.apiKey));
    assert.equal(new Headers(request.headers).get("x-goog-api-key"), options.apiKey);
    const body = JSON.parse(String(request.body));
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(Buffer.from(body.contents[0].parts[1].inline_data.data, "base64").subarray(0, 4).toString(), "RIFF");
    return response("  Me pide el código.  ");
  });
  assert.equal(await transcribeChunk(audio, 24_000, options), "Me pide el código.");
});

test("custom models do not inherit an unsupported thinking configuration", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, request: RequestInit) => {
    assert.equal(JSON.parse(String(request.body)).generationConfig.thinkingConfig, undefined);
    return response("hola");
  });
  assert.equal(await transcribeChunk(audio, 24_000, { ...options, model: "custom-model" }), "hola");
});

test("only an explicit no-speech result is treated as silence; malformed and blocked results fail", async (t) => {
  const replies = [response("(no speech)"), response(""), Response.json({}), Response.json({ candidates: [{ finishReason: "SAFETY" }] }), new Response("invalid JSON")];
  t.mock.method(globalThis, "fetch", async () => replies.shift());
  assert.equal(await transcribeChunk(audio, 24_000, options), "");
  for (let i = 0; i < 4; i++) {
    await assert.rejects(transcribeChunk(audio, 24_000, options), (error: unknown) => error instanceof TranscriptionError && error.kind === "response");
  }
});

test("a transient provider failure retries once and returns the recovered text", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => ++requests === 1 ? new Response("service down", { status: 503 }) : response("recuperado"));
  assert.equal(await transcribeChunk(audio, 24_000, options), "recuperado");
  assert.equal(requests, 2);
});

test("network failure retries only once without exposing provider details or keys", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new TypeError(`fetch failed https://example.test?key=${options.apiKey}`); });
  await assert.rejects(transcribeChunk(audio, 24_000, options), (error: unknown) => {
    assert.ok(error instanceof TranscriptionError);
    assert.equal(error.kind, "network");
    assert.ok(!error.message.includes(options.apiKey));
    return true;
  });
  assert.equal(requests, 2);
});

test("authentication and long quota waits are actionable and are not retried", async (t) => {
  let requests = 0;
  const replies = [new Response(options.apiKey, { status: 403 }), new Response("quota", { status: 429, headers: { "Retry-After": "60" } })];
  t.mock.method(globalThis, "fetch", async () => { requests++; return replies.shift(); });
  for (const kind of ["authentication", "quota"]) {
    await assert.rejects(transcribeChunk(audio, 24_000, options), (error: unknown) => error instanceof TranscriptionError && error.kind === kind && !error.message.includes(options.apiKey));
  }
  assert.equal(requests, 2);
});

test("the overall deadline cancels a stalled fetch instead of retrying it", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, request: RequestInit) => {
    requests++;
    return new Promise((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true }));
  });
  // AbortSignal.timeout is unref'ed; keep the test process alive while it fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(transcribeChunk(audio, 24_000, { ...options, timeoutMs: 10 }), (error: unknown) => error instanceof TranscriptionError && error.kind === "timeout");
    assert.equal(requests, 1);
  } finally { clearTimeout(keepAlive); }
});

test("shutdown cancellation interrupts a retry wait and preserves the cancellation reason", async (t) => {
  const abort = new AbortController();
  const stopped = new Error("monitor stopped");
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    setTimeout(() => abort.abort(stopped), 5);
    return new Response("down", { status: 503 });
  });
  await assert.rejects(transcribeChunk(audio, 24_000, { ...options, signal: abort.signal, retryDelayMs: 1000 }), (error) => error === stopped);
  assert.equal(requests, 1);
});

test("recovery clears only the affected speaker and unknown errors are sanitized", () => {
  const failures = new TranscriptionFailures();
  failures.fail("caller", new TranscriptionError("timeout", "request timed out"));
  failures.fail("subject", new Error(options.apiKey));
  assert.equal(failures.details.length, 2);
  assert.equal(failures.recover("observer"), false);
  assert.equal(failures.recover("caller"), true);
  assert.equal(failures.details.length, 1);
  assert.ok(!failures.details[0]!.includes(options.apiKey));
  failures.recover("subject");
  assert.deepEqual(failures.details, []);
});

test("request budget defaults to 30s and invalid configuration cannot create unbounded work", () => {
  for (const value of ["0", "NaN", "Infinity", "60001"]) assert.equal(transcriptionTimeoutMs({ TRANSCRIBE_TIMEOUT_MS: value }), 30_000);
  assert.equal(transcriptionTimeoutMs({}), 30_000);
  assert.equal(transcriptionTimeoutMs({ TRANSCRIBE_TIMEOUT_MS: "45000" }), 45_000);
});
