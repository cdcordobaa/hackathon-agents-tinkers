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

  const response = await fetch(`${ENDPOINT}/${chosen}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transcription failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return NO_SPEECH.test(text) ? "" : text;
}
