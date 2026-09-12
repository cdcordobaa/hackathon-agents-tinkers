/**
 * Mints an ephemeral client secret for the Realtime API.
 *
 * The browser needs a credential to open its own connection to OpenAI. It must
 * NEVER be your API key — this route exchanges the server-side key for a
 * short-lived secret scoped to one session.
 *
 * Two shapes of session come out of here:
 *
 *   speak  — the agent talks back over WebRTC. The original voice demo.
 *   listen — a transcription-only session that never generates a response,
 *            used once per speaker by the stereo call tap.
 */
import { REALTIME_MODEL, REALTIME_VOICE, TRANSCRIBE_MODEL } from "@/lib/realtime-config";

type Mode = "speak" | "listen";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });
  }

  // The speak path posts no body at all, so an unparseable request is not an
  // error — it is the default.
  const body = (await request.json().catch(() => ({}))) as {
    mode?: string;
    sampleRate?: number;
  };
  const mode: Mode = body.mode === "listen" ? "listen" : "speak";

  // Trust the browser's reported rate only as far as a sane audio range; it
  // comes from AudioContext.sampleRate, which the browser chooses, not us.
  const sampleRate =
    typeof body.sampleRate === "number" && body.sampleRate >= 8000 && body.sampleRate <= 48000
      ? Math.round(body.sampleRate)
      : 24000;

  const session =
    mode === "listen"
      ? {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: sampleRate },
              transcription: { model: TRANSCRIBE_MODEL },
            },
          },
        }
      : {
          type: "realtime",
          model: REALTIME_MODEL,
          audio: { output: { voice: REALTIME_VOICE } },
        };

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return Response.json(
      { error: `OpenAI refused the session: ${detail.slice(0, 300)}` },
      { status: response.status },
    );
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    return Response.json({ error: "No ephemeral secret in the response." }, { status: 502 });
  }

  return Response.json({ value: data.value });
}
