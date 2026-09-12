import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioChunker, measureVoicedMs, toWav, type Chunk } from "./audio-chunker.ts";

const RATE = 16_000;

/** A sine loud enough to read as speech. */
function tone(ms: number, amplitude = 8000): Int16Array {
  const samples = Math.round((RATE * ms) / 1000);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.round(Math.sin((i / RATE) * 2 * Math.PI * 220) * amplitude);
  }
  return pcm;
}

function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((RATE * ms) / 1000));
}

test("measureVoicedMs counts loud windows and ignores quiet ones", () => {
  assert.equal(measureVoicedMs(silence(1000), RATE, 300), 0);
  assert.ok(measureVoicedMs(tone(1000), RATE, 300) >= 960, "a second of tone is ~1000ms voiced");
});

test("room tone below the floor reads as unvoiced", () => {
  // Amplitude 100 is well under the 300 floor.
  assert.equal(measureVoicedMs(tone(500, 100), RATE, 300), 0);
});

test("a chunk is emitted once the buffer reaches chunkMs", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 1000,
    onChunk: (c) => chunks.push(c),
  });

  chunker.push("caller", tone(400));
  assert.equal(chunks.length, 0, "not full yet");

  chunker.push("caller", tone(700));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.speaker, "caller");
  assert.ok((chunks[0]?.durationMs ?? 0) >= 1000);
});

test("silent chunks are dropped, not transcribed", () => {
  const chunks: Chunk[] = [];
  const dropped: string[] = [];

  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 1000,
    onChunk: (c) => chunks.push(c),
    onSilence: (speaker) => dropped.push(speaker),
  });

  chunker.push("caller", silence(1200));

  assert.equal(chunks.length, 0, "silence must never reach the transcriber");
  assert.deepEqual(dropped, ["caller"]);
});

test("a chunk with a little speech in mostly silence still gets through", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 2000,
    minVoicedMs: 400,
    onChunk: (c) => chunks.push(c),
  });

  chunker.push("caller", silence(1400));
  chunker.push("caller", tone(600));

  assert.equal(chunks.length, 1, "600ms of speech is above the 400ms floor");
});

test("speakers are buffered independently", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 1000,
    onChunk: (c) => chunks.push(c),
  });

  chunker.push("caller", tone(600));
  chunker.push("you", tone(600));
  assert.equal(chunks.length, 0, "neither speaker is full");

  chunker.push("caller", tone(600));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.speaker, "caller", "must not mix the two buffers");
});

test("flush emits a partial chunk at end of call", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 10_000,
    onChunk: (c) => chunks.push(c),
  });

  chunker.push("caller", tone(800));
  chunker.flush();

  assert.equal(chunks.length, 1, "the last turn must not be lost");
});

test("flush on an empty buffer emits nothing", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 1000,
    onChunk: (c) => chunks.push(c),
  });

  chunker.flush();
  chunker.flush("nobody");
  assert.equal(chunks.length, 0);
});

test("the emitted PCM is the concatenation of the pushed frames, in order", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 10_000,
    minVoicedMs: 0,
    onChunk: (c) => chunks.push(c),
  });

  chunker.push("caller", Int16Array.from([1, 2, 3]));
  chunker.push("caller", Int16Array.from([4, 5]));
  chunker.flush();

  assert.deepEqual(Array.from(chunks[0]?.pcm ?? []), [1, 2, 3, 4, 5]);
});

test("toWav writes a valid 16-bit mono header", () => {
  const pcm = Int16Array.from([0, 1000, -1000, 32767]);
  const wav = toWav(pcm, RATE);

  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.subarray(36, 40).toString(), "data");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), RATE);
  assert.equal(wav.readUInt16LE(34), 16, "16-bit");
  assert.equal(wav.readUInt32LE(40), pcm.length * 2, "data size");
  assert.equal(wav.length, 44 + pcm.length * 2);
  // Samples survive the round trip.
  assert.equal(wav.readInt16LE(44 + 2), 1000);
});
