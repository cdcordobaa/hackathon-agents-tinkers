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

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 2;

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
};

export async function transcribeChunk(
  pcm: Int16Array,
  sampleRate: number,
  { apiKey, model, signal }: TranscribeOptions,
): Promise<string> {
  const chosen = model ?? process.env.TRANSCRIBE_MODEL ?? "gemini-2.5-flash";
  const wav = toWav(pcm, sampleRate);
  const request = {
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
    },
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${ENDPOINT}/${chosen}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const detail = await response.text();
      if (attempt < MAX_ATTEMPTS && TRANSIENT_STATUSES.has(response.status)) {
        await waitForRetry(response.headers.get("retry-after"), signal);
        continue;
      }
      throw new Error(`Transcription failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    return transcriptText((await response.json()) as GeminiResponse);
  }

  throw new Error("Transcription failed after retrying Gemini.");
}

type GeminiResponse = {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

function transcriptText(body: GeminiResponse): string {
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return NO_SPEECH.test(text) ? "" : text;
}

/** Gemini can briefly throttle concurrent speakers. Respect its retry hint when
 * present, otherwise make one short retry without retaining audio indefinitely. */
async function waitForRetry(retryAfter: string | null, signal?: AbortSignal): Promise<void> {
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const delayMs = Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1_000, 15_000)
    : 1_500;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}
