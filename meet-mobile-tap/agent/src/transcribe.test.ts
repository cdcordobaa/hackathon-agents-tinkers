import assert from "node:assert/strict";
import test from "node:test";
import { transcribeChunk } from "./transcribe.ts";

const pcm = new Int16Array([0, 1, -1, 2]);

test("transcribes the text returned by Gemini", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "hola mundo" }] } }],
  }), { status: 200 })) as typeof fetch;
  try {
    assert.equal(await transcribeChunk(pcm, 24_000, { apiKey: "test" }), "hola mundo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries one transient Gemini throttling response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "listo" }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await transcribeChunk(pcm, 24_000, { apiKey: "test" }), "listo");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry invalid Gemini requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("bad key", { status: 400 });
  }) as typeof fetch;
  try {
    await assert.rejects(transcribeChunk(pcm, 24_000, { apiKey: "test" }), /400.*bad key/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
