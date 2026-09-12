/**
 * A listening Realtime session — transcription only, no voice back.
 *
 * This is the difference between an agent that joins the call and an agent that
 * observes it. A normal Realtime session with server VAD will start *answering*
 * the person on the other end. A transcription session never generates a
 * response: it only tells you what it heard.
 *
 * One session handles one speaker. The stereo tap gives us two mono channels,
 * so the voice page opens two of these and labels them.
 */
import { TRANSCRIBE_MODEL } from "./realtime-config";

export type TranscriptEvent =
  | { type: "delta"; text: string }
  | { type: "completed"; text: string };

export type TranscriptionSession = {
  append: (pcm: Int16Array) => void;
  close: () => void;
};

export type TranscriptionSessionOptions = {
  /** Ephemeral client secret from /api/realtime-token — never the API key. */
  secret: string;
  /** Must match the rate the capture graph is actually producing. */
  sampleRate: number;
  onEvent: (event: TranscriptEvent) => void;
  onError: (message: string) => void;
};

/**
 * The transcription endpoint has been spelled both ways across Realtime
 * revisions: the session type now travels in the ephemeral secret, but the
 * older `intent` query parameter is still what some projects are routed by.
 * A rejected handshake surfaces as a bare close with no readable reason, which
 * is miserable to debug, so try both rather than betting the feature on one.
 */
const ENDPOINTS = [
  "wss://api.openai.com/v1/realtime?intent=transcription",
  "wss://api.openai.com/v1/realtime",
];

function open(url: string, secret: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Browsers cannot set headers on a WebSocket, so the credential rides in
    // the subprotocol list. This is why it must be an ephemeral secret.
    const socket = new WebSocket(url, [
      "realtime",
      `openai-insecure-api-key.${secret}`,
      "openai-beta.realtime-v1",
    ]);

    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Handshake refused at ${url}`));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onClose);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onClose);
  });
}

export async function openTranscriptionSession({
  secret,
  sampleRate,
  onEvent,
  onError,
}: TranscriptionSessionOptions): Promise<TranscriptionSession> {
  let socket: WebSocket | undefined;
  let lastFailure: unknown;

  for (const endpoint of ENDPOINTS) {
    try {
      socket = await open(endpoint, secret);
      break;
    } catch (cause) {
      lastFailure = cause;
    }
  }

  if (!socket) {
    throw new Error(
      lastFailure instanceof Error
        ? `${lastFailure.message}. Check that the key has Realtime access.`
        : "Could not open a transcription session.",
    );
  }

  const live = socket;

  live.send(
    JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: sampleRate },
            transcription: { model: TRANSCRIBE_MODEL },
            // Server VAD is right here even though the model never replies:
            // it is what segments the stream into turns, which is what makes
            // `.completed` fire with a finished sentence instead of the whole
            // call arriving as one run-on line.
            turn_detection: { type: "server_vad", silence_duration_ms: 600 },
          },
        },
      },
    }),
  );

  live.addEventListener("message", (event) => {
    let payload: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }

    switch (payload.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (payload.delta) onEvent({ type: "delta", text: payload.delta });
        break;
      case "conversation.item.input_audio_transcription.completed":
        onEvent({ type: "completed", text: payload.transcript ?? "" });
        break;
      case "error":
        onError(payload.error?.message ?? "The transcription session reported an error.");
        break;
      default:
        break;
    }
  });

  live.addEventListener("close", (event) => {
    // 1000 is our own close() on teardown. Anything else dropped underneath us.
    if (event.code !== 1000) onError(`Transcription session closed (${event.code}).`);
  });

  return {
    append(pcm) {
      if (live.readyState !== WebSocket.OPEN) return;
      live.send(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm) }));
    },
    close() {
      if (live.readyState === WebSocket.OPEN || live.readyState === WebSocket.CONNECTING) {
        live.close(1000);
      }
    },
  };
}

/** Int16Array → base64. Chunked because String.fromCharCode blows the argument
 *  limit somewhere around 100k samples. */
function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
