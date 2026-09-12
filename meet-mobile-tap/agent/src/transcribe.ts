/**
 * Chunk of audio → text, via Gemini's native endpoint.
 *
 * Native rather than the OpenAI-compatible shim, because inline audio is not
 * part of that shim's surface. Analysis still goes through the shim; only this
 * call is provider-shaped.
 *
 * WAV rather than raw PCM: every transcription API accepts a WAV container, and
 * almost none agree on how to describe bare PCM in a mime type.
 *
 * The prompt is doing real work here. Left to its own devices a model handed a
 * short, noisy chunk will translate it, summarise it, add "[Music]", or invent a
 * plausible sentence. Each instruction below exists because that is the default
 * behaviour it suppresses.
 */
import { toWav } from "./audio-chunker.ts";
import { setTimeout as delay } from "node:timers/promises";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const PROMPT = [
  "Transcribe this audio verbatim.",
  "",
  "- Output ONLY the words spoken. No commentary, no speaker labels, no timestamps.",
  "- Keep the original language. Do not translate.",
  "- Do not summarise, clean up grammar, or complete unfinished sentences.",
  "- Do not add sound annotations such as [Music], [Laughter] or [inaudible].",
  "- If there is no intelligible speech, output exactly: (no speech)",
].join("\n");

/** What the model is told to say when it hears nothing. Anything matching this
 *  is discarded rather than written into the transcript. */
const NO_SPEECH = /^\(?\s*no speech\s*\)?\.?$/i;

export type TranscribeOptions = {
  apiKey: string;
  /** Audio understanding needs a full Flash; set TRANSCRIBE_MODEL to override. */
  model?: string;
  signal?: AbortSignal;
  /** Total budget, including the single transient-error retry. */
  timeoutMs?: number;
  retryDelayMs?: number;
};

export type TranscriptionFailure = "timeout" | "network" | "quota" | "authentication" | "model" | "provider" | "response";

export class TranscriptionError extends Error {
  constructor(readonly kind: TranscriptionFailure, message: string, readonly retryable = false) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/** Environment mistakes cannot disable the deadline or create unbounded waits. */
export function transcriptionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.TRANSCRIBE_TIMEOUT_MS ?? 30_000);
  return Number.isInteger(value) && value >= 5_000 && value <= 60_000 ? value : 30_000;
}

function httpFailure(status: number): TranscriptionError {
  if (status === 429) return new TranscriptionError("quota", "Transcription quota exceeded. Check Gemini quota and billing, then retry.", true);
  if (status === 401 || status === 403) return new TranscriptionError("authentication", "Gemini rejected transcription access. Check the server API key and project permissions.");
  if (status === 400 || status === 404) return new TranscriptionError("model", "Gemini rejected the transcription model or request. Check TRANSCRIBE_MODEL.");
  return new TranscriptionError("provider", `Transcription service returned HTTP ${status}.`, status >= 500);
}

/** A healthy speaker must not clear a different speaker's unresolved failure. */
export class TranscriptionFailures {
  private readonly failures = new Map<string, string>();
  fail(speaker: string, error: Error): void {
    this.failures.set(speaker, error instanceof TranscriptionError ? error.message : "Transcription failed. Check the server connection to Gemini.");
  }
  recover(speaker: string): boolean { return this.failures.delete(speaker); }
  get details(): string[] { return [...new Set(this.failures.values())]; }
}

export async function transcribeChunk(
  pcm: Int16Array,
  sampleRate: number,
  { apiKey, model, signal, timeoutMs = transcriptionTimeoutMs(), retryDelayMs = 500 }: TranscribeOptions,
): Promise<string> {
  const chosen = model ?? process.env.TRANSCRIBE_MODEL ?? "gemini-2.5-flash";
  const wav = toWav(pcm, sampleRate);

  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: "audio/wav", data: wav.toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      // Transcription is not a creative task; sampling only invents words.
      temperature: 0,
      // Literal speech recognition does not need Flash's dynamic reasoning.
      ...(chosen === "gemini-2.5-flash" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const checkAbort = () => {
    if (signal?.aborted) throw signal.reason;
    if (deadline.aborted) throw new TranscriptionError("timeout", `Transcription timed out after ${Math.round(timeoutMs / 1_000)}s. Check the connection or retry.`);
  };
  for (let attempt = 0; ; attempt += 1) {
    checkAbort();
    let retryAfterMs = retryDelayMs;
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(chosen)}:generateContent`, {
        method: "POST",
        // Keep credentials out of URLs and network-error strings.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: requestSignal,
        body,
      });
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        await response.body?.cancel();
        throw httpFailure(response.status);
      }
      const result = await response.json() as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      const candidate = result?.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts) || (candidate?.finishReason && candidate.finishReason !== "STOP")) {
        throw new TranscriptionError("response", "Gemini did not return a complete transcript. The audio segment could not be transcribed.");
      }
      const text = parts.filter((part) => part && !part.thought && typeof part.text === "string")
        .map((part) => part.text).join("").trim();
      if (!text) throw new TranscriptionError("response", "Gemini returned an empty transcript. The audio segment could not be transcribed.");
      return NO_SPEECH.test(text) ? "" : text;
    } catch (cause) {
      checkAbort();
      const error = cause instanceof TranscriptionError ? cause
        : cause instanceof SyntaxError ? new TranscriptionError("response", "Gemini returned an unreadable transcription response.")
        : new TranscriptionError("network", "Cannot reach Gemini for transcription. Check the server network connection.", true);
      if (attempt > 0 || !error.retryable || !Number.isFinite(retryAfterMs) || retryAfterMs > 2_000) throw error;
      // One short retry; quota waits longer than 2s are surfaced instead of hammered.
      try { await delay(retryAfterMs, undefined, { signal: requestSignal }); }
      catch { checkAbort(); throw error; }
    }
  }
}
