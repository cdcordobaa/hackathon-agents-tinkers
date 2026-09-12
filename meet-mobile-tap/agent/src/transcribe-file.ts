/**
 * Transcribe a WAV file — the fastest way to prove the transcription half works
 * without a phone, a room, or a live call.
 *
 *   npm run transcribe -- some.wav
 *
 * Generate test audio on macOS:
 *   say -v Paulina -o /tmp/t.aiff "Le habla Andrea del área de seguridad"
 *   afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/t.aiff /tmp/t.wav
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { transcribeChunk } from "./transcribe.ts";
import { measureVoicedMs } from "./audio-chunker.ts";

/** Minimal RIFF reader. Walks the chunk list rather than assuming a 44-byte
 *  header, because plenty of encoders insert LIST/fact chunks before `data`. */
export function readWav(buffer: Buffer): { pcm: Int16Array; sampleRate: number } {
  if (buffer.subarray(0, 4).toString() !== "RIFF" || buffer.subarray(8, 12).toString() !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file.");
  }

  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString();
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bitsPerSample !== 16) throw new Error(`Need 16-bit PCM, got ${bitsPerSample}-bit.`);
      const end = Math.min(body + size, buffer.length);
      const samples = new Int16Array((end - body) / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(body + i * 2);

      if (channels === 1) return { pcm: samples, sampleRate };

      // Downmix to mono — transcription wants one channel.
      const mono = new Int16Array(Math.floor(samples.length / channels));
      for (let i = 0; i < mono.length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += samples[i * channels + c] ?? 0;
        mono[i] = Math.round(sum / channels);
      }
      return { pcm: mono, sampleRate };
    }

    // Chunks are word-aligned; an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  throw new Error("No data chunk found.");
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run transcribe -- <file.wav>");
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set.");
    process.exit(1);
  }

  const { pcm, sampleRate } = readWav(readFileSync(path));
  const voicedMs = measureVoicedMs(pcm, sampleRate, 300);
  const durationMs = Math.round((pcm.length / sampleRate) * 1000);

  console.log(
    `\x1b[90m${path} · ${sampleRate}Hz · ${durationMs}ms · ${voicedMs}ms voiced\x1b[0m`,
  );

  const startedAt = Date.now();
  const text = await transcribeChunk(pcm, sampleRate, { apiKey });
  console.log(`\x1b[90m${Date.now() - startedAt}ms\x1b[0m`);
  console.log(text ? text : "\x1b[90m(no speech)\x1b[0m");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
