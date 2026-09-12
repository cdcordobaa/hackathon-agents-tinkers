/**
 * Buffers per-speaker PCM into transcribable chunks, and throws away the ones
 * with no speech in them.
 *
 * The silence gate is not an optimisation, it is a correctness fix. Transcription
 * models hallucinate on silence — feed one twelve seconds of room tone and it
 * will confidently return "Thanks for watching" or similar. Those land in the
 * transcript as real turns and the analyzer then reasons about words nobody said.
 *
 * It also happens to halve the request count, which matters: free-tier Gemini is
 * single-digit requests per minute, and two speakers on 12s chunks is already 10
 * rpm before the analyzer asks for anything.
 *
 * Voiced detection is deliberately dumb — RMS per 20 ms window, count the windows
 * above a floor. A real VAD would be better at the margins and is not worth the
 * dependency for deciding whether to spend one API call.
 */

export type Chunk = {
  speaker: string;
  pcm: Int16Array;
  sampleRate: number;
  durationMs: number;
  /** Milliseconds of the chunk that looked like speech. */
  voicedMs: number;
};

export type AudioChunkerOptions = {
  sampleRate: number;
  /** How much audio to gather before transcribing. Longer = fewer requests and
   *  better context for the model, at the cost of transcript latency. */
  chunkMs?: number;
  /** Int16 RMS below this is treated as room tone. Speech sits well above it. */
  silenceFloor?: number;
  /** A chunk with less voiced audio than this is dropped untranscribed. */
  minVoicedMs?: number;
  onChunk: (chunk: Chunk) => void;
  /** Told about dropped chunks, so the caller can log rather than wonder. */
  onSilence?: (speaker: string, voicedMs: number) => void;
};

const WINDOW_MS = 20;

export class AudioChunker {
  private readonly buffers = new Map<string, Int16Array[]>();
  private readonly lengths = new Map<string, number>();

  private readonly sampleRate: number;
  private readonly chunkSamples: number;
  private readonly silenceFloor: number;
  private readonly minVoicedMs: number;

  constructor(private readonly options: AudioChunkerOptions) {
    this.sampleRate = options.sampleRate;
    this.chunkSamples = Math.round((this.sampleRate * (options.chunkMs ?? 12_000)) / 1000);
    this.silenceFloor = options.silenceFloor ?? 300;
    this.minVoicedMs = options.minVoicedMs ?? 400;
  }

  push(speaker: string, frame: Int16Array): void {
    if (frame.length === 0) return;

    const parts = this.buffers.get(speaker) ?? [];
    parts.push(frame);
    this.buffers.set(speaker, parts);

    const length = (this.lengths.get(speaker) ?? 0) + frame.length;
    this.lengths.set(speaker, length);

    if (length >= this.chunkSamples) this.emit(speaker);
  }

  /** End of call, or the speaker left. Emits whatever is buffered. */
  flush(speaker?: string): void {
    const speakers = speaker ? [speaker] : [...this.buffers.keys()];
    for (const s of speakers) this.emit(s);
  }

  private emit(speaker: string): void {
    const parts = this.buffers.get(speaker);
    const length = this.lengths.get(speaker) ?? 0;
    if (!parts || length === 0) return;

    this.buffers.set(speaker, []);
    this.lengths.set(speaker, 0);

    const pcm = new Int16Array(length);
    let offset = 0;
    for (const part of parts) {
      pcm.set(part, offset);
      offset += part.length;
    }

    const voicedMs = measureVoicedMs(pcm, this.sampleRate, this.silenceFloor);
    const durationMs = Math.round((length / this.sampleRate) * 1000);

    if (voicedMs < this.minVoicedMs) {
      this.options.onSilence?.(speaker, voicedMs);
      return;
    }

    this.options.onChunk({ speaker, pcm, sampleRate: this.sampleRate, durationMs, voicedMs });
  }
}

/** Milliseconds of audio whose 20 ms windows are above the noise floor. */
export function measureVoicedMs(
  pcm: Int16Array,
  sampleRate: number,
  silenceFloor: number,
): number {
  const windowSamples = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  let voiced = 0;

  for (let start = 0; start + windowSamples <= pcm.length; start += windowSamples) {
    let sum = 0;
    for (let i = start; i < start + windowSamples; i++) {
      const sample = pcm[i] ?? 0;
      sum += sample * sample;
    }
    if (Math.sqrt(sum / windowSamples) >= silenceFloor) voiced += WINDOW_MS;
  }

  return voiced;
}

/** PCM16 → a WAV file, because every transcription API accepts WAV and almost
 *  none agree on how to describe raw PCM. */
export function toWav(pcm: Int16Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes)]);
}
