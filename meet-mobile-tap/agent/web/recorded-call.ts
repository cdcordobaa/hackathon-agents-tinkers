import { ConnectionState, LocalAudioTrack, Room, RoomEvent, Track } from "livekit-client";
import { MONITOR_IDENTITY } from "../../shared/session.ts";
import { planRecordings, type RecordingCue, type RecordingRole } from "../../shared/recording-plan.ts";

export type PreparedRecordings = {
  buffers: Record<RecordingRole, AudioBuffer>;
  cues: RecordingCue[];
  durationMs: number;
};

export type RecordingPlaybackState = {
  phase: "connecting" | "ready" | "playing" | "processing" | "stopped" | "failed";
  elapsedMs: number;
  durationMs: number;
  detail: string;
};

/** Decode only in the browser. File bytes are never uploaded to the gateway. */
export async function prepareRecordings(files: { counterparty: File; subject: File }): Promise<PreparedRecordings> {
  for (const file of Object.values(files)) {
    if (!file || file.size === 0 || file.size > 25 * 1024 * 1024) {
      throw new Error("Choose two nonempty audio files, up to 25 MB each.");
    }
  }
  const decoder = new OfflineAudioContext(1, 1, 48_000);
  const decode = async (file: File) => {
    try { return await decoder.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error(`Could not read ${file.name}. Choose a supported MP3 or WAV recording.`); }
  };
  const [counterparty, subject] = await Promise.all([decode(files.counterparty), decode(files.subject)]);
  const cues = planRecordings({ counterparty: counterparty.duration * 1_000, subject: subject.duration * 1_000 });
  return { buffers: { counterparty, subject }, cues, durationMs: cues[1]!.offsetMs + cues[1]!.durationMs };
}

type Actor = { role: RecordingRole; room: Room; track?: LocalAudioTrack; destination?: MediaStreamAudioDestinationNode };

/** Publishes each voice under its own consent-bound LiveKit participant identity. */
export class RecordedCallPlayback {
  private readonly context = new AudioContext();
  private readonly abort = new AbortController();
  private readonly actors: Actor[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly nodes = new Map<RecordingRole, MediaStreamAudioDestinationNode>();
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = 0;
  private stopped = false;
  private connecting = false;
  private played = false;
  private stopPromise?: Promise<void>;
  private phase: RecordingPlaybackState["phase"] = "connecting";

  constructor(
    private readonly recordings: PreparedRecordings,
    private readonly onState: (state: RecordingPlaybackState) => void,
  ) {}

  /** Invoke from a real click before awaiting network calls (autoplay policy). */
  async unlockAudio(): Promise<void> {
    this.assertOpen();
    await this.context.resume();
    this.assertOpen();
    if (this.context.state !== "running") throw new Error("Allow audio playback in this browser, then try again.");
  }

  async connect(gatewayUrl: string, roomName: string): Promise<void> {
    this.assertOpen();
    if (this.connecting || this.actors.length) throw new Error("The recording participants are already connecting.");
    this.connecting = true;
    this.emit("connecting", "Connecting the two recorded voices…");
    try {
      for (const role of ["counterparty", "subject"] as const) {
        this.assertOpen();
        const identity = `recording-${role}-${crypto.randomUUID().slice(0, 12)}`;
        const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/api/join`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]),
          body: JSON.stringify({ roomName, identity, role, consent: true,
            displayName: role === "counterparty" ? "Other caller · recording" : "Protected person · recording" }),
        });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("The gateway could not join a recorded voice. Check the room and try again.");
        const credentials = body as Record<string, unknown>;
        if (!credentials || typeof credentials.url !== "string" || !/^wss?:\/\//.test(credentials.url) ||
          typeof credentials.token !== "string" || credentials.roomName !== roomName ||
          credentials.identity !== identity || credentials.monitorIdentity !== MONITOR_IDENTITY) {
          throw new Error("The gateway returned invalid recording credentials.");
        }
        this.assertOpen();
        const actor: Actor = { role, room: new Room({ adaptiveStream: false, dynacast: false }) };
        this.actors.push(actor);
        actor.room.on(RoomEvent.Reconnecting, () => this.fail("A recorded voice lost its connection. Start a new recording session."));
        actor.room.on(RoomEvent.Disconnected, () => {
          if (!this.stopped) this.fail("A recorded voice disconnected. Start a new recording session.");
        });
        await actor.room.connect(credentials.url, credentials.token, { autoSubscribe: false, maxRetries: 1 });
        if (this.stopped) await actor.room.disconnect();
        this.assertOpen();
        actor.destination = this.context.createMediaStreamDestination();
        const mediaTrack = actor.destination.stream.getAudioTracks()[0];
        if (!mediaTrack) throw new Error("This browser could not create a recording audio track.");
        actor.track = new LocalAudioTrack(mediaTrack, undefined, true, this.context);
        this.nodes.set(role, actor.destination);
        await actor.room.localParticipant.publishTrack(actor.track, { source: Track.Source.Microphone, name: `recorded-${role}` });
        this.assertOpen();
      }
      this.emit("ready", "Both voices are connected. Ready to play the other caller, then the protected person.");
    } catch (cause) {
      if (!this.stopped) this.fail(cause instanceof Error ? cause.message : "The recordings could not connect.");
      throw cause;
    }
  }

  play(): void {
    this.assertOpen();
    if (this.phase !== "ready" || this.played || this.actors.some((actor) => actor.room.state !== ConnectionState.Connected)) {
      throw new Error("Wait for both recorded voices to connect before starting playback.");
    }
    if (this.context.state !== "running") throw new Error("Audio playback is paused. Allow playback and try again.");
    this.played = true;
    // Silent preroll lets the remote monitor finish subscribing to both tracks.
    this.startedAt = this.context.currentTime + 0.8;
    for (const cue of this.recordings.cues) {
      const source = this.context.createBufferSource();
      source.buffer = this.recordings.buffers[cue.role];
      source.connect(this.nodes.get(cue.role)!);
      this.sources.push(source);
      source.onended = () => { if (!this.stopped) void this.finishVoice(cue.role); };
      source.start(this.startedAt + cue.offsetMs / 1_000);
    }
    this.emit("playing", "Playing the other caller, followed by the protected person.");
    this.timer = setInterval(() => {
      if (this.context.state !== "running") return this.fail("Audio playback was interrupted. Start a new recording session.");
      this.emit("playing", this.elapsedMs() < this.recordings.cues[1]!.offsetMs
        ? "Playing the other caller’s recording." : "Playing the protected person’s recording.");
    }, 250);
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopped = true;
      this.abort.abort();
      if (this.timer) clearInterval(this.timer);
      for (const source of this.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* A completed source can already be stopped. */ }
        source.disconnect();
      }
      for (const actor of this.actors) {
        actor.track?.stop();
        actor.destination?.disconnect();
      }
      const failed = this.phase === "failed";
      this.stopPromise = Promise.allSettled([
        ...this.actors.map((actor) => actor.room.disconnect()), this.context.close(),
      ]).then(() => { if (!failed) this.emit("stopped", "Recording playback stopped."); });
    }
    return this.stopPromise;
  }

  private async finishVoice(role: RecordingRole): Promise<void> {
    if (role === "subject") {
      if (this.timer) clearInterval(this.timer);
      this.emit("processing", "Recordings finished. Waiting for the monitor’s transcript and assessment.");
    }
    // Unpublishing flushes the monitor's short final chunks. Muting alone does not.
    const actor = this.actors.find((entry) => entry.role === role);
    try {
      if (actor?.track) await actor.room.localParticipant.unpublishTrack(actor.track, true);
    } catch {
      if (!this.stopped) this.fail("A recording track could not finish cleanly. The last transcript may be incomplete.");
    }
  }

  private fail(detail: string): void {
    if (this.stopped) return;
    this.emit("failed", detail);
    void this.stop();
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Recording playback was cancelled.");
  }

  private elapsedMs(): number {
    return this.played ? Math.min(this.recordings.durationMs, Math.max(0, (this.context.currentTime - this.startedAt) * 1_000)) : 0;
  }

  private emit(phase: RecordingPlaybackState["phase"], detail: string): void {
    this.phase = phase;
    this.onState({ phase, detail, elapsedMs: this.elapsedMs(), durationMs: this.recordings.durationMs });
  }
}
