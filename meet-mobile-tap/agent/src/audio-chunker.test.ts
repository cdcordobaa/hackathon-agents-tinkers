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

test("a completed short utterance flushes before the maximum chunk duration", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    trailingSilenceMs: 800,
    minChunkMs: 3_000,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", tone(2_200));
  chunker.push("caller", silence(800));

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.durationMs, 3_000);
  assert.equal(chunks[0]?.speaker, "caller");
});

test("a pause shorter than trailingSilenceMs does not flush", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    trailingSilenceMs: 800,
    minChunkMs: 3_000,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", tone(3_000));
  chunker.push("caller", silence(780));
  assert.equal(chunks.length, 0);

  chunker.push("caller", silence(20));
  assert.equal(chunks.length, 1);
});

test("minChunkMs prevents short utterances from fragmenting the request stream", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    trailingSilenceMs: 800,
    minChunkMs: 3_000,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", tone(500));
  chunker.push("caller", silence(800));
  assert.equal(chunks.length, 0, "a 1.3s fragment must remain buffered");

  chunker.push("caller", silence(1_700));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.durationMs, 3_000);
});

test("trailing-silence VAD spans arbitrary 10 ms RTC frames", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    minVoicedMs: 400,
    trailingSilenceMs: 800,
    minChunkMs: 1_000,
    onChunk: (chunk) => chunks.push(chunk),
  });

  for (let i = 0; i < 40; i += 1) chunker.push("caller", tone(10));
  for (let i = 0; i < 79; i += 1) chunker.push("caller", silence(10));
  assert.equal(chunks.length, 0);
  chunker.push("caller", silence(10));

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.durationMs, 1_200);
  assert.equal(chunks[0]?.voicedMs, 400);
});

test("early-flush state remains independent for each speaker", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    minVoicedMs: 400,
    trailingSilenceMs: 800,
    minChunkMs: 1_000,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", tone(400));
  chunker.push("you", tone(400));
  chunker.push("caller", silence(800));
  assert.deepEqual(chunks.map((chunk) => chunk.speaker), ["caller"]);

  chunker.push("you", silence(800));
  assert.deepEqual(chunks.map((chunk) => chunk.speaker), ["caller", "you"]);
});

test("long leading silence does not consume chunkMs or minChunkMs", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    minVoicedMs: 400,
    trailingSilenceMs: 800,
    minChunkMs: 3_000,
    trimLeadingSilence: true,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", silence(20_000));
  chunker.push("caller", tone(500));
  chunker.push("caller", silence(800));
  assert.equal(chunks.length, 0, "pre-speech room tone must not satisfy the minimum");

  chunker.push("caller", silence(1_500));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.durationMs, 3_000, "only bounded preroll and post-detection audio are buffered");
});

test("trimLeadingSilence retains at most 200 ms of silent preroll", () => {
  const chunks: Chunk[] = [];
  const quiet = tone(350, 100);
  const expectedPreroll = quiet.subarray(quiet.length - Math.round(RATE * 0.2));
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 600,
    minVoicedMs: 400,
    trimLeadingSilence: true,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", quiet);
  chunker.push("caller", tone(400));

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.durationMs, 600);
  assert.deepEqual(chunks[0]?.pcm.subarray(0, expectedPreroll.length), expectedPreroll);
});

test("leading-silence trimming resets for the next utterance", () => {
  const chunks: Chunk[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 12_000,
    minVoicedMs: 400,
    trailingSilenceMs: 800,
    minChunkMs: 1_000,
    trimLeadingSilence: true,
    onChunk: (chunk) => chunks.push(chunk),
  });

  chunker.push("caller", tone(400));
  chunker.push("caller", silence(800));
  chunker.push("caller", silence(5_000));
  chunker.push("caller", tone(400));
  chunker.push("caller", silence(800));

  assert.deepEqual(chunks.map((chunk) => chunk.durationMs), [1_200, 1_400]);
});

test("silence-only input stays in bounded preroll and never requests transcription", () => {
  const chunks: Chunk[] = [];
  const dropped: string[] = [];
  const chunker = new AudioChunker({
    sampleRate: RATE,
    chunkMs: 1_000,
    trimLeadingSilence: true,
    onChunk: (chunk) => chunks.push(chunk),
    onSilence: (speaker) => dropped.push(speaker),
  });

  for (let i = 0; i < 2_000; i += 1) chunker.push("caller", silence(10));
  chunker.flush();

  assert.equal(chunks.length, 0);
  assert.equal(dropped.length, 0, "preroll never becomes a candidate model chunk");
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
