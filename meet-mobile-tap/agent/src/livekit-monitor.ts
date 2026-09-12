import {
  AudioStream,
  Room,
  RoomEvent,
  TrackKind,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import {
  MONITOR_IDENTITY,
  SESSION_TOPIC,
  type CallParticipant,
  type CallSnapshot,
  type CallTurn,
  type RiskProfile,
} from "../../shared/session.ts";
import { ProgressiveAnalyzer } from "./analyzer.ts";
import { AudioChunker, type Chunk } from "./audio-chunker.ts";
import {
  analysisSpeakerLabel,
  normalizedLevel,
  parseParticipantMetadata,
  pcmRms,
  type ParticipantDescriptor,
} from "./livekit-monitor-helpers.ts";
import { resolveModelSetup } from "./model-client.ts";
import { SpeakerTaskQueue } from "./speaker-task-queue.ts";
import { transcribeChunk, TranscriptionError, TranscriptionFailures } from "./transcribe.ts";
import { RollingTranscript } from "./transcript.ts";

const SAMPLE_RATE = 24_000;
const SNAPSHOT_INTERVAL_MS = 1_000;
const AUDIO_HEALTH_MS = 2_000;
const AUDIBLE_RMS = 100;
const ANALYSIS_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const STOP_MODEL_BUDGET_MS = 5_000;
const PUBLISH_TIMEOUT_MS = 1_500;
const MAX_PACKET_BYTES = 14_500;

export type LiveKitMonitorOptions = {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  onLog?: (message: string) => void;
};

type ParticipantState = ParticipantDescriptor & {
  id: string;
  level: number;
  lastAudibleAt: number;
  audioTracks: number;
  lastRmsLogAt: number;
};

type TrackRun = {
  participantId: string;
  stream: AudioStream;
};

/**
 * Join a LiveKit call as a receive-only audio monitor. The returned stop method
 * flushes accepted audio, STT, and the final analysis before disconnecting.
 */
export async function createLiveKitMonitor(
  options: LiveKitMonitorOptions,
): Promise<{ stop(): Promise<void> }> {
  const startedAt = Date.now();
  const room = new Room();
  const transcript = new RollingTranscript();
  const participants = new Map<string, ParticipantState>();
  const speakerDetails = new Map<string, ParticipantDescriptor>();
  const trackRuns = new Map<RemoteTrack, TrackRun>();
  const turns: CallTurn[] = [];
  let profile: RiskProfile | null = null;
  let sequence = 0;
  let turnSequence = 0;
  let transcriptionsInFlight = 0;
  let stopping = false;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  let lastPublishAt = 0;
  let scheduledPublish: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let publishInFlight: Promise<void> | undefined;
  let publishPending = false;
  let transportDisconnected = false;
  const operationAbort = new AbortController();
  const degradation = new Set<string>();
  const transcriptionFailures = new TranscriptionFailures();

  const log = (message: string) => {
    try {
      options.onLog?.(message);
    } catch {
      // A display callback must not take down call monitoring.
    }
  };

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!geminiKey) degradation.add("Transcription unavailable: set GEMINI_API_KEY.");

  let modelSetup: ReturnType<typeof resolveModelSetup> | undefined;
  try {
    modelSetup = resolveModelSetup();
  } catch {
    degradation.add("Risk analysis unavailable: configure an OpenAI or Gemini model key.");
  }

  const snapshotStatus = (): Pick<CallSnapshot, "status" | "detail"> => {
    if (stopped) return { status: "ended", detail: "Monitoring ended." };
    const failures = [...degradation, ...transcriptionFailures.details];
    if (failures.length > 0) {
      return { status: "degraded", detail: failures.join(" ") };
    }
    if (transcriptionsInFlight > 0) {
      return { status: "analyzing", detail: "Transcribing observed call audio." };
    }
    const active = [...participants.values()].filter(
      (participant) => participant.consented && participant.lastAudibleAt > Date.now() - AUDIO_HEALTH_MS,
    ).length;
    if (active > 0) {
      return {
        status: "listening",
        detail: `Receiving audible signal from ${active} consented participant${active === 1 ? "" : "s"}.`,
      };
    }
    return {
      status: "waiting",
      detail: "Waiting for audible signal from a consented participant.",
    };
  };

  const buildSnapshot = (): CallSnapshot => {
    const now = Date.now();
    const visibleParticipants: CallParticipant[] = [...participants.values()]
      .map((participant) => {
        const isFresh = participant.lastAudibleAt > now - AUDIO_HEALTH_MS;
        return {
          id: participant.id,
          name: participant.displayName,
          role: participant.role,
          level: isFresh ? participant.level : 0,
          // A subscribed track alone is not proof audio is flowing.
          hasAudio: participant.audioTracks > 0 && isFresh,
          consented: participant.consented,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 32);
    const state = snapshotStatus();
    return {
      version: 1,
      type: "session.snapshot",
      roomName: options.roomName,
      sequence: sequence++,
      startedAt,
      updatedAt: Math.max(startedAt, now),
      ...state,
      participants: visibleParticipants,
      turns: turns.slice(-60).map((turn) => ({ ...turn, text: turn.text.slice(0, 2_000) })),
      profile: compactProfile(profile),
    };
  };

  const publishNow = () => {
    if (!room.localParticipant || stopped) return;
    if (publishInFlight) {
      publishPending = true;
      return;
    }
    lastPublishAt = Date.now();
    const snapshot = fitSnapshot(buildSnapshot());
    const data = new TextEncoder().encode(JSON.stringify(snapshot));
    const task = withTimeout(
        room.localParticipant!.publishData(data, { reliable: true, topic: SESSION_TOPIC }),
        PUBLISH_TIMEOUT_MS,
        "Snapshot publication timed out.",
      )
      .catch(() => log("Snapshot publication failed; monitoring continues."));
    publishInFlight = task;
    void task.finally(() => {
      if (publishInFlight !== task) return;
      publishInFlight = undefined;
      if (publishPending && !stopping) {
        publishPending = false;
        requestPublish(true);
      }
    });
  };

  const requestPublish = (significant = false) => {
    if (stopping || stopped || !room.localParticipant) return;
    const minimumGap = significant ? 200 : SNAPSHOT_INTERVAL_MS;
    const delay = Math.max(0, minimumGap - (Date.now() - lastPublishAt));
    if (delay === 0) {
      if (scheduledPublish) clearTimeout(scheduledPublish);
      scheduledPublish = undefined;
      publishNow();
      return;
    }
    if (!scheduledPublish) {
      scheduledPublish = setTimeout(() => {
        scheduledPublish = undefined;
        publishNow();
      }, delay);
    }
  };

  const analyzer = modelSetup
    ? new ProgressiveAnalyzer({
        transcript,
        client: modelSetup.client,
        model: modelSetup.model,
        supportsStrictSchema: modelSetup.supportsStrictSchema,
        intervalMs: modelSetup.suggestedIntervalMs,
        requestTimeoutMs: ANALYSIS_TIMEOUT_MS,
        signal: operationAbort.signal,
        onResult: (result) => {
          degradation.delete("Risk analysis unavailable after a model request failed.");
          profile = result;
          requestPublish(true);
        },
        onError: () => {
          degradation.add("Risk analysis unavailable after a model request failed.");
          log("Risk analysis request failed; no unvalidated profile was published.");
          requestPublish(true);
        },
      })
    : undefined;

  // Four waiting utterances absorb a bounded 30s provider slowdown without
  // discarding the short remainder of an otherwise healthy conversation.
  const transcriptionQueue = new SpeakerTaskQueue(4, (speakerId, error) => {
    if (operationAbort.signal.aborted) return;
    transcriptionFailures.fail(speakerId, error);
    const reason = error instanceof TranscriptionError ? `${error.kind}: ${error.message}` : "connection or provider failure";
    log(`Transcription failed for ${safeLabel(speakerId)} (${reason}); the affected audio chunk was omitted.`);
    requestPublish(true);
  });

  const processChunk = async (chunk: Chunk, capturedAt: number) => {
    const descriptor = speakerDetails.get(chunk.speaker);
    if (!geminiKey || !descriptor?.consented) return;
    transcriptionsInFlight += 1;
    requestPublish(true);
    const requestedAt = Date.now();
    try {
      const text = await transcribeChunk(chunk.pcm, chunk.sampleRate, {
        apiKey: geminiKey,
        signal: operationAbort.signal,
      });
      const recovered = transcriptionFailures.recover(chunk.speaker);
      log(`Transcription ${recovered ? "recovered" : "completed"} for ${safeLabel(chunk.speaker)} in ${Date.now() - requestedAt}ms (${chunk.durationMs}ms audio).`);
      // Consent can be revoked while a request is in flight.
      const current = speakerDetails.get(chunk.speaker);
      if (!text || !current?.consented) return;
      const at = Math.max(0, capturedAt - startedAt);
      transcript.final(analysisSpeakerLabel(current), text, at);
      turns.push({
        id: `${chunk.speaker}:${++turnSequence}`,
        speakerId: chunk.speaker,
        speakerName: current.displayName,
        text,
        at,
      });
      turns.sort((left, right) => left.at - right.at);
      if (turns.length > 60) turns.splice(0, turns.length - 60);
      requestPublish(true);
    } finally {
      transcriptionsInFlight -= 1;
      requestPublish(true);
    }
  };

  const chunker = new AudioChunker({
    sampleRate: SAMPLE_RATE,
    trailingSilenceMs: 800,
    minChunkMs: 3_000,
    trimLeadingSilence: true,
    onChunk: (chunk) => {
      const capturedAt = Date.now() - chunk.durationMs;
      if (!transcriptionQueue.enqueue(chunk.speaker, () => processChunk(chunk, capturedAt))) {
        log(`Audio backlog full for ${safeLabel(chunk.speaker)}; one bounded chunk was dropped.`);
        transcriptionFailures.fail(chunk.speaker, new TranscriptionError("provider", "Transcription is falling behind; an audio segment was skipped. Waiting for the queued audio."));
        requestPublish(true);
      }
    },
    onSilence: (speakerId) => log(`Silent chunk skipped for ${safeLabel(speakerId)}.`),
  });

  const detachTrack = (track: RemoteTrack, flush = true) => {
    const run = trackRuns.get(track);
    if (!run) return;
    trackRuns.delete(track);
    const state = participants.get(run.participantId);
    if (state) {
      state.audioTracks = Math.max(0, state.audioTracks - 1);
      if (state.audioTracks === 0) {
        state.level = 0;
        state.lastAudibleAt = 0;
      }
    }
    void run.stream.cancel().catch(() => {});
    if (flush) chunker.flush(run.participantId);
    requestPublish(true);
  };

  const attachTrack = (track: RemoteTrack, participant: RemoteParticipant) => {
    if (
      stopping ||
      participant.identity === MONITOR_IDENTITY ||
      track.kind !== TrackKind.KIND_AUDIO ||
      trackRuns.has(track)
    ) return;

    const state = upsertParticipant(participant, participants, speakerDetails);
    if (!state.consented) {
      log(`Ignoring unconsented audio from ${safeLabel(state.displayName)}.`);
      requestPublish(true);
      return;
    }

    let stream: AudioStream;
    try {
      stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 });
    } catch {
      degradation.add("An audio track could not be opened.");
      log(`Could not open audio track for ${safeLabel(state.displayName)}.`);
      requestPublish(true);
      return;
    }
    state.audioTracks += 1;
    trackRuns.set(track, { participantId: participant.identity, stream });
    requestPublish(true);

    void (async () => {
      try {
        for await (const frame of stream) {
          if (stopping) break;
          const current = participants.get(participant.identity);
          if (!current?.consented) continue;
          const pcm = frame.data.slice();
          const rms = pcmRms(pcm);
          current.level = normalizedLevel(rms);
          if (rms >= AUDIBLE_RMS) current.lastAudibleAt = Date.now();
          if (Date.now() - current.lastRmsLogAt >= SNAPSHOT_INTERVAL_MS) {
            current.lastRmsLogAt = Date.now();
            log(
              `Audio ${safeLabel(current.displayName)}: RMS ${Math.round(rms)}, level ${current.level.toFixed(2)}.`,
            );
          }
          chunker.push(participant.identity, pcm);
        }
      } catch {
        if (!stopping) log(`Audio stream ended unexpectedly for ${safeLabel(state.displayName)}.`);
      } finally {
        detachTrack(track);
      }
    })();
  };

  const refreshParticipant = (participant: RemoteParticipant) => {
    if (participant.identity === MONITOR_IDENTITY) return;
    const before = participants.get(participant.identity)?.consented ?? false;
    const state = upsertParticipant(participant, participants, speakerDetails);
    if (before && !state.consented) {
      for (const [track, run] of trackRuns) {
        if (run.participantId === participant.identity) detachTrack(track);
      }
    } else if (!before && state.consented) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attachTrack(publication.track as RemoteTrack, participant);
      }
    }
    requestPublish(true);
  };

  room.on(RoomEvent.ParticipantConnected, refreshParticipant);
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    for (const [track, run] of trackRuns) {
      if (run.participantId === participant.identity) detachTrack(track);
    }
    participants.delete(participant.identity);
    requestPublish(true);
  });
  room.on(RoomEvent.ParticipantMetadataChanged, (_metadata, participant) => {
    if (participant.identity !== MONITOR_IDENTITY) refreshParticipant(participant as RemoteParticipant);
  });
  room.on(RoomEvent.ParticipantNameChanged, (_name, participant) => {
    if (participant.identity !== MONITOR_IDENTITY) refreshParticipant(participant as RemoteParticipant);
  });
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    attachTrack(track, participant);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track));
  room.on(RoomEvent.TrackSubscriptionFailed, (_sid, participant) => {
    degradation.add("A remote audio subscription failed.");
    log(`Track subscription failed for ${safeLabel(participant.identity)}.`);
    requestPublish(true);
  });
  room.on(RoomEvent.Disconnected, () => {
    transportDisconnected = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    if (!stopping) {
      degradation.add("LiveKit disconnected; audio monitoring has stopped.");
      log("LiveKit disconnected; call monitoring is no longer receiving audio.");
    }
  });
  room.on(RoomEvent.Reconnecting, () => {
    degradation.add("LiveKit is reconnecting; live audio may be interrupted.");
    requestPublish(true);
  });
  room.on(RoomEvent.Reconnected, () => {
    transportDisconnected = false;
    degradation.delete("LiveKit is reconnecting; live audio may be interrupted.");
    if (!heartbeat && !stopping) {
      heartbeat = setInterval(() => requestPublish(), SNAPSHOT_INTERVAL_MS);
    }
    requestPublish(true);
  });

  const token = new AccessToken(options.apiKey, options.apiSecret, {
    identity: MONITOR_IDENTITY,
    name: "SecureGuIA monitor",
    ttl: "2h",
  });
  token.addGrant({
    roomJoin: true,
    room: options.roomName,
    canSubscribe: true,
    canPublish: false,
    canPublishData: true,
  });

  try {
    await withTimeout(
      room.connect(options.url, await token.toJwt(), {
        autoSubscribe: true,
        dynacast: false,
      }),
      CONNECT_TIMEOUT_MS,
      "LiveKit connection timed out.",
    );
  } catch {
    await withTimeout(room.disconnect(), 2_000, "LiveKit disconnect timed out.").catch(() => {});
    throw new Error(`Could not connect the SecureGuIA monitor to room ${safeLabel(options.roomName)}.`);
  }

  for (const participant of room.remoteParticipants.values()) {
    refreshParticipant(participant);
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) attachTrack(publication.track as RemoteTrack, participant);
    }
  }
  analyzer?.start();
  log(`SecureGuIA monitor joined ${safeLabel(options.roomName)} at 24 kHz mono.`);
  publishNow();
  if (!transportDisconnected) {
    heartbeat = setInterval(() => requestPublish(), SNAPSHOT_INTERVAL_MS);
  }

  return {
    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        stopping = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        if (scheduledPublish) clearTimeout(scheduledPublish);
        scheduledPublish = undefined;
        publishPending = false;
        analyzer?.stop();
        const stopBudget = setTimeout(
          () => operationAbort.abort(new Error("Monitor shutdown deadline reached.")),
          STOP_MODEL_BUDGET_MS,
        );

        try {
          const tracks = [...trackRuns.keys()];
          const streams = [...trackRuns.values()].map((run) => run.stream);
          for (const track of tracks) detachTrack(track, false);
          await withTimeout(
            Promise.allSettled(streams.map((stream) => stream.cancel())),
            1_000,
            "Audio stream shutdown timed out.",
          ).catch(() => {});

          chunker.flush();
          transcriptionQueue.close();
          await transcriptionQueue.drain();
          if (analyzer) await analyzer.flush();
        } finally {
          clearTimeout(stopBudget);
        }

        if (publishInFlight) await publishInFlight;
        stopped = true;
        const finalData = new TextEncoder().encode(JSON.stringify(fitSnapshot(buildSnapshot())));
        if (room.localParticipant) {
          await withTimeout(
            room.localParticipant.publishData(finalData, { reliable: true, topic: SESSION_TOPIC }),
            PUBLISH_TIMEOUT_MS,
            "Final snapshot publication timed out.",
          ).catch(() => log("Final session snapshot could not be published."));
        }
        await withTimeout(room.disconnect(), 2_000, "LiveKit disconnect timed out.").catch(() => {});
        log("SecureGuIA monitor stopped after flushing accepted work.");
      })();
      return stopPromise;
    },
  };
}

function upsertParticipant(
  participant: RemoteParticipant,
  participants: Map<string, ParticipantState>,
  speakerDetails: Map<string, ParticipantDescriptor>,
): ParticipantState {
  const descriptor = parseParticipantMetadata(
    participant.metadata,
    participant.name || participant.identity,
  );
  speakerDetails.set(participant.identity, descriptor);
  const existing = participants.get(participant.identity);
  const state: ParticipantState = existing
    ? Object.assign(existing, descriptor)
    : {
        id: participant.identity,
        ...descriptor,
        level: 0,
        lastAudibleAt: 0,
        audioTracks: 0,
        lastRmsLogAt: 0,
      };
  participants.set(participant.identity, state);
  return state;
}

function compactProfile(profile: RiskProfile | null): RiskProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    headline: profile.headline.slice(0, 500),
    advice: profile.advice.slice(0, 1_000),
    changed: profile.changed.slice(0, 1_000),
    signals: profile.signals.slice(0, 10).map((signal) => ({
      type: signal.type.slice(0, 200),
      quote: signal.quote.slice(0, 1_000),
      why: signal.why.slice(0, 1_000),
    })),
  };
}

function fitSnapshot(snapshot: CallSnapshot): CallSnapshot {
  const candidate: CallSnapshot = {
    ...snapshot,
    turns: [...snapshot.turns],
    profile: snapshot.profile ? { ...snapshot.profile, signals: [...snapshot.profile.signals] } : null,
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(candidate), "utf8");
  while (bytes() > MAX_PACKET_BYTES && candidate.turns.length > 0) candidate.turns.shift();
  while (bytes() > MAX_PACKET_BYTES && candidate.profile?.signals.length) candidate.profile.signals.pop();
  while (bytes() > MAX_PACKET_BYTES && candidate.participants.length > 0) {
    candidate.participants.pop();
  }
  return candidate;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeLabel(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 100);
}
