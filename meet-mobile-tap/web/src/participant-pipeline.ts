/**
 * Wires one LiveKit participant's audio track to: a level meter, a
 * transcription-only Realtime session, and a stream of contract-shaped
 * TranscriptSegments. One instance per participant (local included) — see
 * livekit/room.ts, which is what discovers tracks and calls this.
 *
 * Role is assigned exactly as the task spec states: the browser operator
 * (the local participant) is `subject`; every other participant is
 * `counterparty`. That is a simplification openspec explicitly allows for
 * this two/three-person demo shape (unknown participants would fall back to
 * role "unknown" per shared/src/speaker.ts, but there is no such participant
 * here — everyone in the room is either "us" or "them").
 *
 * `sequence` is monotonic per speaker, assigned here, starting at 0 — the
 * gateway orders by it, not by arrival order (shared/src/transcript-source.ts).
 * `providerEventKey` is `livekit:{speakerId}:{sequence}`, fixed at the moment
 * a segment is built and never regenerated — a retried POST (see
 * gateway/transcript-poster.ts) resends the identical object.
 *
 * `text` for a non-final segment is the FULL accumulated in-progress turn,
 * not just the latest delta chunk. This matters: RollingTranscript.delta()
 * (agent/src/transcript.ts) replaces the open line for a speaker rather than
 * appending, because "most engines resend the whole in-progress turn on each
 * delta" — but OpenAI's Realtime transcription delta event gives incremental
 * fragments, so this file is the place that turns "fragment" into "whole
 * line so far" before it goes out.
 */
import { startTrackTap, type TrackTapHandle } from "./lib/track-tap.ts";
import { openTranscriptionSession, type TranscriptionSession } from "./lib/transcription-session.ts";
import type { SpeakerRole, TranscriptSegment } from "../../shared/src/index.ts";

export type ParticipantPipelineOptions = {
  identity: string;
  isLocal: boolean;
  track: MediaStreamTrack;
  tokenServerUrl: string;
  /** Session-clock ms, matching TranscriptSourceStartContext.startedAt's
   *  epoch as closely as this app can approximate it — see README.md's
   *  "What's unverified" for the caveat on exactness. */
  atMs: () => number;
  onLevel: (level: number) => void;
  onTranscript: (line: { text: string; isFinal: boolean }) => void;
  onSegment: (segment: TranscriptSegment) => void;
  onDegraded: (reason: string) => void;
};

export type ParticipantPipelineHandle = {
  stop: () => void;
};

export async function startParticipantPipeline(
  opts: ParticipantPipelineOptions,
): Promise<ParticipantPipelineHandle> {
  const role: SpeakerRole = opts.isLocal ? "subject" : "counterparty";
  let sequence = 0;

  const buildSegment = (text: string, isFinal: boolean): TranscriptSegment => {
    const seq = sequence;
    sequence += 1;
    return {
      speakerId: opts.identity,
      role,
      text,
      isFinal,
      sequence: seq,
      providerEventKey: `livekit:${opts.identity}:${seq}`,
      atMs: opts.atMs(),
    };
  };

  let transcription: TranscriptionSession | undefined;
  let tap: TrackTapHandle | undefined;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  let partial = "";

  try {
    tap = await startTrackTap(opts.track, (pcm) => transcription?.append(pcm));
    levelTimer = setInterval(() => opts.onLevel(tap?.getLevel() ?? 0), 120);

    const secret = await fetchEphemeralSecret(opts.tokenServerUrl, tap.sampleRate);
    transcription = await openTranscriptionSession({
      secret,
      sampleRate: tap.sampleRate,
      onEvent: (event) => {
        if (event.type === "delta") {
          partial += event.text;
          if (!partial) return;
          opts.onTranscript({ text: partial, isFinal: false });
          opts.onSegment(buildSegment(partial, false));
          return;
        }

        // Discard whitespace-only finals — matches the rule
        // add-live-transcription applies to every other transport (empty
        // speech-detection artifacts are not turns).
        const text = event.text.trim();
        partial = "";
        if (!text) return;
        opts.onTranscript({ text, isFinal: true });
        opts.onSegment(buildSegment(text, true));
      },
      onError: (message) => opts.onDegraded(message),
    });
  } catch (cause) {
    opts.onDegraded(cause instanceof Error ? cause.message : String(cause));
  }

  return {
    stop() {
      if (levelTimer) clearInterval(levelTimer);
      tap?.stop();
      transcription?.close();
    },
  };
}

/**
 * Stands in for the gateway endpoint openspec's design.md leaves as an "Open
 * Question" — `POST {gatewayUrl}/session/:id/realtime-secret` or equivalent,
 * to be minted by whoever builds that route. Until it exists, this app talks
 * to its own tiny local token-server (../../token-server/server.mjs) so the
 * real OpenAI API key still never reaches the bundle — see that file and
 * README.md.
 */
async function fetchEphemeralSecret(tokenServerUrl: string, sampleRate: number): Promise<string> {
  const res = await fetch(`${tokenServerUrl}/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "listen", sampleRate }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token-server -> ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as { value?: string; error?: string };
  if (!body.value) throw new Error(body.error ?? "token-server returned no secret");
  return body.value;
}
