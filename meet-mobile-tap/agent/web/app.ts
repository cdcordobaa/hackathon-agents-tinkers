import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import {
  MONITOR_IDENTITY,
  type CallParticipant,
  type CallSnapshot,
  type RiskProfile,
} from "../../shared/session.ts";
import {
  ROOM_STALE_AFTER_MS,
  acceptRoomSnapshot,
  currentRoomProfile,
  initialRoomSession,
  type RoomSessionState,
} from "../../shared/room-session.ts";
import {
  RecordedCallPlayback,
  prepareRecordings,
  type PreparedRecordings,
  type RecordingPlaybackState,
} from "./recorded-call.ts";

type AppMode = "setup" | "live" | "preview" | "recorded";
type Health = {
  livekitConfigured: boolean;
  analysisConfigured: boolean;
  transcriptionConfigured: boolean;
};
type JoinResponse = {
  url: string;
  token: string;
  roomName: string;
  identity: string;
  monitorIdentity: string;
};
type VisibleParticipant = CallParticipant & { isLocal: boolean };

const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
};

const ui = {
  setupView: element<HTMLElement>("setup-view"),
  callView: element<HTMLElement>("call-view"),
  environmentBadge: element<HTMLElement>("environment-badge"),
  joinForm: element<HTMLFormElement>("join-form"),
  joinButton: element<HTMLButtonElement>("join-button"),
  joinButtonLabel: element<HTMLElement>("join-button-label"),
  joinDescription: element<HTMLElement>("join-description"),
  roomName: element<HTMLInputElement>("room-name"),
  displayName: element<HTMLInputElement>("display-name"),
  displayNameField: element<HTMLElement>("display-name-field"),
  role: element<HTMLSelectElement>("role"),
  roleField: element<HTMLElement>("role-field"),
  recordedFields: element<HTMLElement>("recorded-fields"),
  counterpartyAudio: element<HTMLInputElement>("counterparty-audio"),
  subjectAudio: element<HTMLInputElement>("subject-audio"),
  consent: element<HTMLInputElement>("consent"),
  consentTitle: element<HTMLElement>("consent-title"),
  consentDetail: element<HTMLElement>("consent-detail"),
  setupError: element<HTMLElement>("setup-error"),
  previewButton: element<HTMLButtonElement>("preview-button"),
  previewBanner: element<HTMLElement>("preview-banner"),
  recordedBanner: element<HTMLElement>("recorded-banner"),
  callStateLine: element<HTMLElement>("call-state-line"),
  callTitle: element<HTMLElement>("call-title"),
  roomSummary: element<HTMLElement>("room-summary"),
  elapsedTime: element<HTMLElement>("elapsed-time"),
  callError: element<HTMLElement>("call-error"),
  roomShare: element<HTMLElement>("room-share"),
  shareRoomName: element<HTMLElement>("share-room-name"),
  copyRoomLink: element<HTMLButtonElement>("copy-room-link"),
  audioProof: element<HTMLElement>("audio-proof"),
  participantCount: element<HTMLElement>("participant-count"),
  participantList: element<HTMLElement>("participant-list"),
  participantEmpty: element<HTMLElement>("participant-empty"),
  callControls: element<HTMLElement>("call-controls"),
  recordedControls: element<HTMLElement>("recorded-controls"),
  recordedPhase: element<HTMLElement>("recorded-phase"),
  recordedProgressTime: element<HTMLElement>("recorded-progress-time"),
  recordedDetail: element<HTMLElement>("recorded-detail"),
  recordedProgressFill: element<HTMLElement>("recorded-progress-fill"),
  startRecordings: element<HTMLButtonElement>("start-recordings"),
  recordedAudioButton: element<HTMLButtonElement>("recorded-audio-button"),
  stopRecordings: element<HTMLButtonElement>("stop-recordings"),
  replayRecordings: element<HTMLButtonElement>("replay-recordings"),
  muteButton: element<HTMLButtonElement>("mute-button"),
  muteLabel: element<HTMLElement>("mute-label"),
  audioButton: element<HTMLButtonElement>("audio-button"),
  leaveButton: element<HTMLButtonElement>("leave-button"),
  analysisState: element<HTMLElement>("analysis-state"),
  analysisFreshness: element<HTMLElement>("analysis-freshness"),
  riskDisplay: element<HTMLElement>("risk-display"),
  riskBand: element<HTMLElement>("risk-band"),
  riskScore: element<HTMLElement>("risk-score"),
  riskHeadline: element<HTMLElement>("risk-headline"),
  riskChange: element<HTMLElement>("risk-change"),
  riskScaleFill: element<HTMLElement>("risk-scale-fill"),
  riskAdvice: element<HTMLElement>("risk-advice"),
  evidenceCount: element<HTMLElement>("evidence-count"),
  evidenceList: element<HTMLElement>("evidence-list"),
  evidenceEmpty: element<HTMLElement>("evidence-empty"),
  monitorDetail: element<HTMLElement>("monitor-detail"),
  transcriptCount: element<HTMLElement>("transcript-count"),
  transcriptList: element<HTMLOListElement>("transcript-list"),
  transcriptEmpty: element<HTMLElement>("transcript-empty"),
  remoteAudio: element<HTMLElement>("remote-audio"),
};

const state: {
  mode: AppMode;
  setupMode: "live" | "recorded";
  room?: Room;
  roomName: string;
  displayName: string;
  role: "subject" | "counterparty";
  identity: string;
  startedAt: number;
  roomSession: RoomSessionState;
  previewSnapshot: CallSnapshot | null;
  lastRenderedFreshness: boolean | null;
  frameTimer?: number;
  previewTimer?: number;
  previewStage: number;
  preparedRecordings?: PreparedRecordings;
  recordedPlayback?: RecordedCallPlayback;
  recordedPlaybackState?: RecordingPlaybackState;
  health: Health | null;
  attachedTracks: Map<string, { track: RemoteTrack; audio: HTMLAudioElement; participantId: string }>;
} = {
  mode: "setup",
  setupMode: "live",
  roomName: "",
  displayName: "",
  role: "counterparty",
  identity: "",
  startedAt: 0,
  roomSession: initialRoomSession(),
  previewSnapshot: null,
  lastRenderedFreshness: null,
  previewStage: 0,
  health: null,
  attachedTracks: new Map(),
};

function setText(target: HTMLElement, value: string): void {
  target.textContent = value;
}

function setError(target: HTMLElement, message?: string): void {
  target.hidden = !message;
  setText(target, message ?? "");
}

function make(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function titleCase(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeIdentity(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 22) || "caller";
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36).slice(-8);
  return `browser-${slug}-${suffix}`;
}

function browserRoomLink(roomName: string): string {
  const link = new URL(window.location.href);
  link.search = "";
  link.hash = "";
  link.searchParams.set("room", roomName);
  return link.toString();
}

function isJoinResponse(value: unknown): value is JoinResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["url", "token", "roomName", "identity", "monitorIdentity"].every(
    (key) => typeof result[key] === "string" && result[key].length > 0,
  );
}

async function loadHealth(): Promise<void> {
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    const value = (await response.json()) as Partial<Health>;
    if (
      typeof value.livekitConfigured !== "boolean" ||
      typeof value.analysisConfigured !== "boolean" ||
      typeof value.transcriptionConfigured !== "boolean"
    ) throw new Error("Health response was incomplete");
    state.health = value as Health;
    renderHealth();
  } catch {
    state.health = null;
    renderHealth();
  }
}

function renderHealth(): void {
  const items: Array<[keyof Health, string]> = [
    ["livekitConfigured", "livekit"],
    ["transcriptionConfigured", "transcription"],
    ["analysisConfigured", "analysis"],
  ];
  for (const [key, id] of items) {
    const label = element<HTMLElement>(`health-${id}`);
    const dot = element<HTMLElement>(`health-${id}-dot`);
    dot.className = "service-dot";
    if (state.health === null) {
      setText(label, "Status unavailable");
      dot.classList.add("is-checking");
    } else if (state.health[key]) {
      setText(label, "Configured");
      dot.classList.add("is-ready");
    } else {
      setText(label, "Not configured");
      dot.classList.add("is-unavailable");
    }
  }
}

function configureRoom(room: Room): void {
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio && participant.identity !== MONITOR_IDENTITY) {
      attachRemoteAudio(track, publication.trackSid, participant);
    }
    renderCall();
  });
  room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
    detachRemoteAudio(publication.trackSid);
    renderCall();
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    detachParticipantAudio(participant.identity);
    renderCall();
  });
  room.on(RoomEvent.ParticipantConnected, renderCall);
  room.on(RoomEvent.TrackMuted, renderCall);
  room.on(RoomEvent.TrackUnmuted, renderCall);
  room.on(RoomEvent.LocalTrackPublished, renderCall);
  room.on(RoomEvent.LocalTrackUnpublished, renderCall);
  room.on(RoomEvent.ActiveSpeakersChanged, renderParticipants);
  room.on(RoomEvent.AudioPlaybackStatusChanged, renderAudioControl);
  room.on(RoomEvent.ConnectionStateChanged, renderCall);
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    const next = acceptRoomSnapshot(state.roomSession, {
      payload,
      senderIdentity: participant?.identity,
      topic,
      roomName: state.roomName,
    });
    if (next === state.roomSession) return;
    state.roomSession = next;
    renderCall();
  });
  room.on(RoomEvent.Disconnected, () => {
    if (state.room !== room) return;
    if (state.mode === "live") {
      showSetup("The live call ended. You can rejoin when the room is ready.");
    } else if (state.mode === "recorded") {
      const durationMs = state.recordedPlaybackState?.durationMs ?? state.preparedRecordings?.durationMs ?? 0;
      state.recordedPlaybackState = recordingState(
        "failed",
        durationMs,
        "The observer lost its room connection. Replay in a fresh room.",
      );
      void state.recordedPlayback?.stop();
      renderCall();
    }
  });
}

function attachRemoteAudio(track: RemoteTrack, trackSid: string, participant: RemoteParticipant): void {
  if (state.attachedTracks.has(trackSid)) return;
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.dataset.participantId = participant.identity;
  audio.setAttribute("aria-hidden", "true");
  ui.remoteAudio.append(audio);
  track.attach(audio);
  state.attachedTracks.set(trackSid, { track, audio, participantId: participant.identity });
  renderAudioControl();
}

function detachRemoteAudio(trackSid: string): void {
  const attached = state.attachedTracks.get(trackSid);
  if (!attached) return;
  attached.track.detach(attached.audio);
  attached.audio.remove();
  state.attachedTracks.delete(trackSid);
}

function detachParticipantAudio(participantId: string): void {
  for (const [trackSid, attached] of state.attachedTracks) {
    if (attached.participantId === participantId) detachRemoteAudio(trackSid);
  }
}

function detachAllAudio(): void {
  for (const trackSid of [...state.attachedTracks.keys()]) detachRemoteAudio(trackSid);
  ui.remoteAudio.replaceChildren();
}

function renderSetupMode(): void {
  const recorded = state.setupMode === "recorded";
  ui.displayNameField.hidden = recorded;
  ui.roleField.hidden = recorded;
  ui.recordedFields.hidden = !recorded;
  setText(
    ui.joinDescription,
    recorded
      ? "Prepare two local test recordings, then start them from the call dashboard."
      : "Your microphone starts only after you join.",
  );
  setText(ui.joinButtonLabel, recorded ? "Prepare recorded call" : "Join live call");
  setText(
    ui.consentTitle,
    recorded
      ? "I have permission to analyze both test recordings."
      : "Everyone on this call has agreed to be monitored.",
  );
  setText(
    ui.consentDetail,
    recorded
      ? "Their audio will be sent through LiveKit for real transcription and Gemini analysis after you start."
      : "Audio will be transcribed and analyzed during the call.",
  );
}

function recordingState(
  phase: RecordingPlaybackState["phase"],
  durationMs: number,
  detail: string,
): RecordingPlaybackState {
  return { phase, durationMs, detail, elapsedMs: 0 };
}

function createRecordedPlayback(prepared: PreparedRecordings): RecordedCallPlayback {
  let playback: RecordedCallPlayback;
  playback = new RecordedCallPlayback(prepared, (next) => {
    if (state.recordedPlayback !== playback) return;
    const previousPhase = state.recordedPlaybackState?.phase;
    state.recordedPlaybackState = next;
    if (state.mode !== "recorded") return;
    renderRecordedControls();
    if (next.phase !== previousPhase) renderCall();
  });
  return playback;
}

async function prepareRecordedCall(): Promise<void> {
  setError(ui.setupError);
  const roomName = ui.roomName.value.trim();
  const counterparty = ui.counterpartyAudio.files?.[0];
  const subject = ui.subjectAudio.files?.[0];
  if (!ROOM_NAME_PATTERN.test(roomName)) {
    setError(ui.setupError, "Use 1–64 letters, numbers, hyphens, or underscores for the room name.");
    ui.roomName.focus();
    return;
  }
  if (!counterparty || !subject) {
    setError(ui.setupError, "Choose one complete bank-agent recording and one complete protected-person recording.");
    (counterparty ? ui.subjectAudio : ui.counterpartyAudio).focus();
    return;
  }
  if (!ui.consent.checked) {
    setError(ui.setupError, "Confirm you have permission to analyze both recordings before continuing.");
    ui.consent.focus();
    return;
  }

  ui.joinButton.disabled = true;
  setText(ui.joinButtonLabel, "Preparing audio…");
  try {
    const prepared = await prepareRecordings({ counterparty, subject });
    state.mode = "recorded";
    state.roomName = roomName;
    state.displayName = "Demo observer";
    state.role = "subject";
    state.identity = "";
    state.startedAt = Date.now();
    state.roomSession = initialRoomSession();
    state.previewSnapshot = null;
    state.lastRenderedFreshness = null;
    state.preparedRecordings = prepared;
    state.recordedPlaybackState = recordingState(
      "ready",
      prepared.durationMs,
      "Join this room from mobile if desired, then start both recordings.",
    );
    state.recordedPlayback = createRecordedPlayback(prepared);
    showCallView();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(ui.setupError, `Could not prepare the recordings: ${message}`);
  } finally {
    ui.joinButton.disabled = false;
    setText(ui.joinButtonLabel, "Prepare recorded call");
  }
}

async function requestJoinCredentials(options: {
  roomName: string;
  identity: string;
  displayName: string;
  role: "subject" | "counterparty";
}): Promise<JoinResponse> {
  const response = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...options, consent: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : `Join request returned ${response.status}`;
    throw new Error(detail);
  }
  if (!isJoinResponse(value)) throw new Error("The join response was incomplete.");
  if (value.monitorIdentity !== MONITOR_IDENTITY) {
    throw new Error("The server returned an unexpected monitor identity.");
  }
  return value;
}

async function joinLiveCall(): Promise<void> {
  setError(ui.setupError);
  const roomName = ui.roomName.value.trim();
  const displayName = ui.displayName.value.trim();
  const role = ui.role.value === "subject" ? "subject" : "counterparty";

  if (!ROOM_NAME_PATTERN.test(roomName)) {
    setError(ui.setupError, "Use 1–64 letters, numbers, hyphens, or underscores for the room name.");
    ui.roomName.focus();
    return;
  }
  if (displayName.length < 2) {
    setError(ui.setupError, "Enter the name other people should see in the room.");
    ui.displayName.focus();
    return;
  }
  if (!ui.consent.checked) {
    setError(ui.setupError, "Confirm that everyone has agreed before joining the monitored call.");
    ui.consent.focus();
    return;
  }
  if (state.health?.livekitConfigured === false) {
    setError(ui.setupError, "Live calls are not configured on this server. Use the demo preview or add LiveKit credentials.");
    return;
  }

  ui.joinButton.disabled = true;
  setText(ui.joinButtonLabel, "Joining…");

  const identity = safeIdentity(displayName);
  try {
    const value = await requestJoinCredentials({ roomName, identity, displayName, role });

    const room = new Room({ adaptiveStream: true, dynacast: true });
    configureRoom(room);
    state.room = room;
    state.mode = "live";
    state.roomName = value.roomName;
    state.displayName = displayName;
    state.role = role;
    state.identity = value.identity;
    state.roomSession = initialRoomSession();
    state.previewSnapshot = null;
    state.lastRenderedFreshness = null;

    await room.connect(value.url, value.token, { autoSubscribe: true });
    state.startedAt = Date.now();
    showCallView();

    try {
      await room.startAudio();
    } catch {
      // Browsers may require a second, direct gesture. The audio button remains visible.
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(ui.callError, `Connected, but the microphone could not start: ${message}. Check browser permission, then try Enable microphone.`);
    }
    renderCall();
  } catch (cause) {
    const message = cause instanceof DOMException && cause.name === "TimeoutError"
      ? "The gateway did not respond within 15 seconds. Check that it is running, then try again."
      : cause instanceof Error ? cause.message : String(cause);
    cleanupSession();
    setError(ui.setupError, `Could not join the live call: ${message}`);
  } finally {
    ui.joinButton.disabled = false;
    setText(ui.joinButtonLabel, "Join live call");
  }
}

async function connectRecordedObserver(playback: RecordedCallPlayback): Promise<void> {
  const identity = safeIdentity("recording-observer");
  const credentials = await requestJoinCredentials({
    roomName: state.roomName,
    identity,
    displayName: "Demo observer",
    role: "subject",
  });
  if (state.mode !== "recorded" || state.recordedPlayback !== playback) {
    throw new Error("Recorded playback was cancelled.");
  }
  const room = new Room({ adaptiveStream: true, dynacast: false });
  configureRoom(room);
  state.room = room;
  state.identity = credentials.identity;
  await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
  if (state.mode !== "recorded" || state.recordedPlayback !== playback) {
    state.room = undefined;
    await room.disconnect();
    throw new Error("Recorded playback was cancelled.");
  }
  try {
    await room.startAudio();
  } catch {
    // The visible Enable audio control handles browsers that need another gesture.
  }
}

async function startRecordedCall(): Promise<void> {
  const playback = state.recordedPlayback;
  const prepared = state.preparedRecordings;
  if (state.mode !== "recorded" || !playback || !prepared ||
    state.recordedPlaybackState?.phase !== "ready") return;

  // AudioContext.resume() must be the first awaited work in this click handler.
  const unlocked = playback.unlockAudio();
  state.recordedPlaybackState = recordingState(
    "connecting",
    prepared.durationMs,
    "Joining as a silent observer before the two recorded voices enter.",
  );
  renderCall();
  try {
    await unlocked;
    await connectRecordedObserver(playback);
    await playback.connect(window.location.origin, state.roomName);
    playback.play();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (state.recordedPlayback === playback) {
      await playback.stop();
      await disconnectRecordedObserver();
      state.recordedPlaybackState = recordingState("failed", prepared.durationMs, message);
      renderCall();
    }
  }
}

async function disconnectRecordedObserver(): Promise<void> {
  const room = state.room;
  state.room = undefined;
  state.identity = "";
  detachAllAudio();
  if (room && room.state !== ConnectionState.Disconnected) await room.disconnect();
  state.roomSession = initialRoomSession();
  state.lastRenderedFreshness = null;
}

async function exitRecordedCall(): Promise<void> {
  const playback = state.recordedPlayback;
  state.recordedPlayback = undefined;
  if (playback) await playback.stop();
  await disconnectRecordedObserver();
  state.preparedRecordings = undefined;
  state.recordedPlaybackState = undefined;
  showSetup();
}

function freshRecordedRoom(roomName: string): string {
  const suffix = Date.now().toString(36).slice(-4);
  return `${roomName.slice(0, 59)}-${suffix}`;
}

async function replayRecordedCall(): Promise<void> {
  const prepared = state.preparedRecordings;
  const retired = state.recordedPlayback;
  if (state.mode !== "recorded" || !prepared || !retired) return;
  state.recordedPlayback = undefined;
  await retired.stop();
  await disconnectRecordedObserver();
  state.roomName = freshRecordedRoom(state.roomName);
  ui.roomName.value = state.roomName;
  state.startedAt = Date.now();
  state.recordedPlaybackState = recordingState(
    "ready",
    prepared.durationMs,
    "Fresh room prepared. Join it from mobile if desired, then start the recordings.",
  );
  state.recordedPlayback = createRecordedPlayback(prepared);
  renderCall();
  renderFrame();
}

function showCallView(): void {
  ui.setupView.hidden = true;
  ui.callView.hidden = false;
  ui.previewBanner.hidden = state.mode !== "preview";
  ui.recordedBanner.hidden = state.mode !== "recorded";
  ui.environmentBadge.hidden = false;
  ui.environmentBadge.className = `environment-badge ${state.mode === "preview" ? "preview" : "live"}`;
  setText(
    ui.environmentBadge,
    state.mode === "preview" ? "Simulated preview" : state.mode === "recorded" ? "Recorded analysis" : "Live room",
  );
  setError(ui.callError);
  if (state.frameTimer) window.clearInterval(state.frameTimer);
  state.frameTimer = window.setInterval(renderFrame, 200);
  renderCall();
  renderFrame();
}

function showSetup(message?: string): void {
  cleanupSession();
  state.mode = "setup";
  ui.setupView.hidden = false;
  ui.callView.hidden = true;
  ui.environmentBadge.hidden = true;
  setError(ui.setupError, message);
}

function cleanupSession(): void {
  if (state.frameTimer) window.clearInterval(state.frameTimer);
  if (state.previewTimer) window.clearInterval(state.previewTimer);
  state.frameTimer = undefined;
  state.previewTimer = undefined;
  const playback = state.recordedPlayback;
  state.recordedPlayback = undefined;
  if (playback) void playback.stop();
  detachAllAudio();
  const room = state.room;
  state.room = undefined;
  if (room && room.state !== ConnectionState.Disconnected) room.disconnect();
  state.roomSession = initialRoomSession();
  state.previewSnapshot = null;
  state.lastRenderedFreshness = null;
  state.preparedRecordings = undefined;
  state.recordedPlaybackState = undefined;
}

function activeSnapshot(): CallSnapshot | null {
  return state.mode === "preview" ? state.previewSnapshot : state.roomSession.snapshot;
}

function snapshotIsCurrent(now = Date.now()): boolean {
  const snapshot = activeSnapshot();
  if (!snapshot) return false;
  if (state.mode === "preview") return true;
  const receivedAt = state.roomSession.receivedAt;
  return state.room?.state === ConnectionState.Connected && receivedAt !== null &&
    Number.isFinite(now) && now >= receivedAt && now - receivedAt <= ROOM_STALE_AFTER_MS;
}

function renderFrame(): void {
  setText(ui.elapsedTime, formatElapsed(Date.now() - state.startedAt));
  renderParticipants();
  renderFreshness();
  if (state.mode === "recorded") renderRecordedControls();
  const currentFreshness = snapshotIsCurrent();
  if (activeSnapshot() && currentFreshness !== state.lastRenderedFreshness) renderCall();
}

function recordedPhaseLabel(phase: RecordingPlaybackState["phase"]): string {
  const labels: Record<RecordingPlaybackState["phase"], string> = {
    connecting: "Connecting recorded voices",
    ready: "Recordings prepared",
    playing: "Playback in progress",
    processing: "Waiting for final analysis",
    stopped: "Playback stopped",
    failed: "Playback failed",
  };
  return labels[phase];
}

function renderRecordedControls(): void {
  const playback = state.recordedPlaybackState;
  if (!playback) return;
  const snapshot = activeSnapshot();
  setText(
    ui.recordedPhase,
    playback.phase === "processing" && snapshot?.profile
      ? "Last assessment available"
      : recordedPhaseLabel(playback.phase),
  );
  setText(
    ui.recordedProgressTime,
    `${formatElapsed(playback.elapsedMs)} / ${formatElapsed(playback.durationMs)}`,
  );
  setText(
    ui.recordedDetail,
    playback.phase === "processing" && snapshot?.profile
      ? `${playback.detail} The last assessment may still update until you reset this room.`
      : playback.detail,
  );
  const progress = playback.durationMs > 0 ? Math.min(1, playback.elapsedMs / playback.durationMs) : 0;
  ui.recordedProgressFill.style.transform = `scaleX(${progress})`;
  ui.startRecordings.hidden = playback.phase !== "ready";
  ui.stopRecordings.hidden = playback.phase === "stopped";
  ui.replayRecordings.hidden = !(
    playback.phase === "processing" || playback.phase === "failed" || snapshot?.status === "degraded"
  );
}

function renderCall(): void {
  if (state.mode === "setup") return;
  const snapshot = activeSnapshot();
  const room = state.room;
  const isPreview = state.mode === "preview";
  const isRecorded = state.mode === "recorded";
  const recordingPhase = state.recordedPlaybackState?.phase ?? "ready";
  const connected = isPreview || room?.state === ConnectionState.Connected;
  const visible = getVisibleParticipants();
  const monitorState = !snapshot ? "monitor waiting" : snapshotIsCurrent() ? snapshot.status : "monitor update stale";

  const recordedTitle: Record<RecordingPlaybackState["phase"], string> = {
    connecting: "Joining recorded call…",
    ready: "Recorded call ready",
    playing: "Recorded call playing",
    processing: "Processing final analysis",
    stopped: "Recorded call stopped",
    failed: "Recorded call needs attention",
  };
  setText(
    ui.callTitle,
    isRecorded
      ? recordedTitle[recordingPhase]
      : connected ? snapshot?.status === "ended" ? "Call ended" : "Call in progress" : "Joining call…",
  );
  setText(
    ui.callStateLine,
    isPreview
      ? "●  Simulated session playing"
      : isRecorded
        ? `●  Recorded files · ${recordedPhaseLabel(recordingPhase)}`
      : connected
        ? `●  Live · ${monitorState}`
        : `●  ${room?.state ?? "connecting"}`,
  );
  setText(ui.roomSummary, `${state.roomName} · ${visible.length} ${visible.length === 1 ? "person" : "people"}`);
  setText(ui.shareRoomName, state.roomName);
  ui.roomShare.hidden = isPreview;
  ui.callControls.hidden = isRecorded;
  ui.recordedControls.hidden = !isRecorded;
  setText(ui.participantCount, String(visible.length));
  setText(
    ui.monitorDetail,
    snapshot && !snapshotIsCurrent()
      ? "Monitor update is stale; this transcript may be out of date"
      : snapshot?.detail || (isPreview ? "Simulated monitor is updating" : "Waiting for the SecureGuIA monitor"),
  );
  setText(ui.transcriptCount, `${snapshot?.turns.length ?? 0} ${(snapshot?.turns.length ?? 0) === 1 ? "turn" : "turns"}`);
  renderParticipants();
  renderAudioControl();
  renderAssessment();
  renderTranscript();
  if (isRecorded) renderRecordedControls();

  ui.muteButton.disabled = isPreview || !connected;
  ui.leaveButton.disabled = false;
  setText(ui.leaveButton.lastElementChild as HTMLElement, isPreview ? "Exit preview" : "Leave");
  if (isRecorded) {
    setText(
      ui.participantEmpty,
      recordingPhase === "ready" ? "The two recorded voices join when you start playback." : "Waiting for recorded voices…",
    );
  } else if (isPreview) {
    ui.muteButton.setAttribute("aria-pressed", "false");
    setText(ui.muteLabel, "Mic simulated");
  } else if (room) {
    const enabled = room.localParticipant.isMicrophoneEnabled;
    ui.muteButton.setAttribute("aria-pressed", String(!enabled));
    setText(ui.muteLabel, enabled ? "Mute" : "Enable microphone");
  }
}

function getVisibleParticipants(): VisibleParticipant[] {
  const snapshotParticipants = activeSnapshot()?.participants ?? [];
  if (state.mode === "preview") return snapshotParticipants.map((person) => ({ ...person, isLocal: person.id === "you" }));
  const room = state.room;
  if (!room) return [];
  const participants: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  return participants
    .filter((participant) => participant.identity !== MONITOR_IDENTITY)
    .map((participant) => {
      const reported = snapshotParticipants.find((item) => item.id === participant.identity);
      const publication = participant.getTrackPublication(Track.Source.Microphone);
      const isLocal = participant.isLocal;
      return {
        id: participant.identity,
        name: participant.name || reported?.name || (isLocal ? state.displayName : participant.identity),
        role: reported?.role ?? (isLocal ? state.role : "unknown"),
        level: Math.max(participant.audioLevel ?? 0, snapshotIsCurrent() ? reported?.level ?? 0 : 0),
        hasAudio: Boolean(publication && !publication.isMuted),
        consented: reported?.consented ?? isLocal,
        isLocal,
      };
    });
}

function renderParticipants(): void {
  if (state.mode === "setup") return;
  const participants = getVisibleParticipants();
  const movingAudio = participants.some((person) => person.hasAudio && person.level > 0.015);
  setText(
    ui.audioProof,
    state.mode === "recorded" && state.recordedPlaybackState?.phase === "ready"
      ? "Silent observer · microphone stays off"
      : movingAudio ? "Voice activity detected" : "Connected · waiting for voice activity",
  );
  ui.participantList.replaceChildren(...participants.map(participantNode));
  ui.participantEmpty.hidden = participants.length > 0;
}

function participantNode(person: VisibleParticipant): HTMLElement {
  const row = make("div", "participant-row");
  const line = make("div", "participant-line");
  const identity = make("div", "participant-identity");
  const initials = person.name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
  identity.append(make("span", "participant-avatar", initials));
  const copy = make("span", "participant-copy");
  copy.append(make("span", "participant-name", `${person.name}${person.isLocal ? " (you)" : ""}`));
  const role = person.isLocal && state.mode === "recorded"
    ? "Silent observer"
    : person.role === "subject" ? "Protected caller" : person.role === "counterparty" ? "Other caller" : "Participant";
  copy.append(make("span", "participant-meta", `${role} · ${person.consented ? "consent confirmed" : "consent pending"}`));
  identity.append(copy);
  const level = Math.round(Math.min(1, Math.max(0, person.level)) * 100);
  const audio = make("span", `participant-audio${person.hasAudio ? "" : " muted"}`, person.hasAudio ? `${level}%` : "Mic off");
  line.append(identity, audio);
  const track = make("div", "level-track");
  const fill = make("div", "level-fill");
  const visibleLevel = person.hasAudio ? Math.max(level, level > 0 ? 3 : 0) / 100 : 0;
  fill.style.transform = `scaleX(${visibleLevel})`;
  track.append(fill);
  row.append(line, track);
  return row;
}

function renderAudioControl(): void {
  const shouldShow = Boolean(state.room) && !state.room!.canPlaybackAudio;
  ui.audioButton.hidden = !(state.mode === "live" && shouldShow);
  ui.recordedAudioButton.hidden = !(state.mode === "recorded" && shouldShow);
}

function renderFreshness(): void {
  if (state.mode === "setup") return;
  const snapshot = activeSnapshot();
  ui.analysisFreshness.className = "freshness";
  if (!snapshot) {
    setText(ui.analysisFreshness, "No analysis yet");
    return;
  }
  if (state.mode === "preview") {
    ui.analysisFreshness.classList.add("current");
    setText(ui.analysisFreshness, "Simulated update");
    return;
  }
  if (state.mode === "recorded") {
    const phase = state.recordedPlaybackState?.phase;
    const currentProfile = state.room?.state === ConnectionState.Connected
      ? currentRoomProfile(state.roomSession)
      : null;
    if (snapshot.profile && (phase !== "playing" || !currentProfile)) {
      ui.analysisFreshness.classList.add("stale");
      setText(ui.analysisFreshness, "Last assessment");
      return;
    }
    if (phase === "processing") {
      ui.analysisFreshness.classList.add("current");
      setText(ui.analysisFreshness, "Awaiting final assessment");
      return;
    }
    if (phase === "failed" || phase === "stopped") {
      ui.analysisFreshness.classList.add("stale");
      setText(ui.analysisFreshness, "Recorded run stopped");
      return;
    }
  }
  if (snapshot.status === "ended") {
    ui.analysisFreshness.classList.add("stale");
    setText(ui.analysisFreshness, "Call ended");
    return;
  }
  if (snapshot.status === "degraded") {
    ui.analysisFreshness.classList.add("stale");
    setText(ui.analysisFreshness, "Monitor degraded");
    return;
  }
  const receivedAt = state.roomSession.receivedAt ?? Date.now();
  const age = Math.max(0, Date.now() - receivedAt);
  if (snapshotIsCurrent()) {
    ui.analysisFreshness.classList.add("current");
    setText(ui.analysisFreshness, `Updated ${Math.floor(age / 1_000)}s ago`);
  } else {
    ui.analysisFreshness.classList.add("stale");
    setText(ui.analysisFreshness, "Update is stale");
  }
}

function renderAssessment(): void {
  const snapshot = activeSnapshot();
  const now = Date.now();
  const current = snapshotIsCurrent(now);
  state.lastRenderedFreshness = current;
  const currentProfile = state.room?.state === ConnectionState.Connected
    ? currentRoomProfile(state.roomSession, now)
    : null;
  const recordingPhase = state.recordedPlaybackState?.phase;
  const historical = state.mode === "recorded" && Boolean(snapshot?.profile) &&
    (recordingPhase !== "playing" || currentProfile === null);
  const profile = state.mode === "preview"
    ? snapshot?.profile ?? null
    : historical ? snapshot!.profile : currentProfile;
  const degraded = snapshot?.status === "degraded";
  const ended = snapshot?.status === "ended";

  renderFreshness();
  if (historical) {
    setText(
      ui.analysisState,
      recordingPhase === "processing"
        ? "Playback complete · last received assessment"
        : "Monitor is waiting · showing the last assessment",
    );
  } else if (state.mode === "recorded" && !profile) {
    const recordedStates: Partial<Record<RecordingPlaybackState["phase"], string>> = {
      ready: "Recordings prepared · waiting to start",
      connecting: "Connecting the observer and recorded voices",
      playing: "Listening for analyzable speech",
      processing: "Recordings finished · waiting for final analysis",
      failed: "Recorded playback stopped before a current assessment",
      stopped: "Recorded playback stopped",
    };
    setText(
      ui.analysisState,
      degraded ? snapshot?.detail || "Recorded-call monitor is degraded"
        : recordedStates[recordingPhase ?? "ready"] ?? "Waiting for the recorded call",
    );
  } else if (!snapshot) {
    setText(ui.analysisState, state.mode === "preview" ? "Loading sample assessment" : "Waiting for the monitor to publish");
  } else if (!current) {
    setText(ui.analysisState, "Monitor updates have stopped");
  } else if (ended) {
    setText(ui.analysisState, "Call ended; the last assessment is historical");
  } else if (degraded) {
    setText(ui.analysisState, snapshot.detail || "Monitor is degraded");
  } else if (!profile) {
    setText(ui.analysisState, snapshot.status === "analyzing" ? "Analyzing the latest speech" : "Listening for enough context");
  } else {
    setText(ui.analysisState, state.mode === "preview" ? "Simulated assessment" : "Evidence-backed assessment");
  }

  if (!profile) {
    if (state.mode === "recorded") {
      if (degraded) {
        renderUnavailableRisk(
          "The recorded-call monitor is unavailable.",
          snapshot?.detail || "Reset the run and replay in a fresh room.",
        );
      } else if (recordingPhase === "processing") {
        renderUnavailableRisk(
          "Recordings finished. Waiting for the final assessment.",
          "Keep this room open while transcription and analysis finish.",
        );
      } else if (recordingPhase === "ready") {
        renderUnavailableRisk(
          "Both recordings are prepared in the requested order.",
          "Join this room from mobile if desired, then start the recordings.",
        );
      } else {
        renderUnavailableRisk(
          "No current recorded-call assessment is available.",
          state.recordedPlaybackState?.detail ?? "Reset the run and try again in a fresh room.",
        );
      }
    } else if (ended) {
      renderUnavailableRisk(
        "The call has ended. Live guidance is unavailable.",
        "Start a new live call to receive a current assessment.",
      );
    } else if (degraded) {
      renderUnavailableRisk(
        "Live guidance is unavailable while the monitor recovers.",
        "Do not rely on the last assessment as current guidance.",
      );
    } else {
      renderUnavailableRisk(
        snapshot
          ? current ? "Assessment is still pending." : "The latest monitor update is stale."
          : "Assessment will appear as the conversation develops.",
      );
    }
    return;
  }
  renderRisk(profile, historical);
}

function renderUnavailableRisk(headline: string, advice?: string): void {
  ui.riskDisplay.className = "risk-display risk-unavailable";
  setText(ui.riskBand, "Pending");
  setText(ui.riskScore, "—");
  setText(ui.riskHeadline, headline);
  setText(ui.riskChange, activeSnapshot()?.detail || "No current profile is available.");
  ui.riskScaleFill.style.transform = "scaleX(0)";
  setText(
    ui.riskAdvice,
    advice ?? "Keep listening. SecureGuIA will show a specific next step when current evidence is available.",
  );
  ui.evidenceList.replaceChildren();
  setText(ui.evidenceCount, "0 signals");
  ui.evidenceEmpty.hidden = false;
}

function renderRisk(profile: RiskProfile, historical = false): void {
  const visualRisk = profile.risk === "none" ? "low" : profile.risk;
  ui.riskDisplay.className = `risk-display risk-${visualRisk}`;
  const band = profile.risk === "none" ? "No risk found" : `${titleCase(profile.risk)} risk`;
  setText(ui.riskBand, historical ? `Last · ${band}` : band);
  setText(ui.riskScore, String(profile.score));
  setText(ui.riskHeadline, profile.headline);
  setText(ui.riskChange, profile.changed);
  ui.riskScaleFill.style.transform = `scaleX(${profile.score / 100})`;
  const advice = profile.advice || "No action is recommended from the available evidence.";
  setText(ui.riskAdvice, historical ? `Last assessment: ${advice}` : advice);
  ui.evidenceList.replaceChildren(...profile.signals.map((signal) => {
    const item = make("article", "evidence-item");
    item.append(make("span", "evidence-type", titleCase(signal.type)));
    const copy = make("div");
    copy.append(make("p", "evidence-quote", `“${signal.quote}”`));
    copy.append(make("p", "evidence-why", signal.why));
    item.append(copy);
    return item;
  }));
  setText(ui.evidenceCount, `${profile.signals.length} ${profile.signals.length === 1 ? "signal" : "signals"}`);
  ui.evidenceEmpty.hidden = profile.signals.length > 0;
}

function renderTranscript(): void {
  const turns = activeSnapshot()?.turns ?? [];
  ui.transcriptList.replaceChildren(...turns.map((turn) => {
    const item = make("li", "turn");
    item.append(make("time", "turn-time", formatElapsed(turn.at)));
    item.append(make("span", "turn-speaker", turn.speakerName));
    item.append(make("p", "turn-text", turn.text));
    return item;
  }));
  ui.transcriptEmpty.hidden = turns.length > 0;
}

function beginPreview(): void {
  cleanupSession();
  state.mode = "preview";
  state.roomName = "demo-preview";
  state.displayName = "María";
  state.role = "subject";
  state.identity = "you";
  state.startedAt = Date.now() - 2 * 60_000 - 18_000;
  state.previewStage = 1;
  state.previewSnapshot = previewSnapshot(state.previewStage, state.startedAt);
  showCallView();
  state.previewTimer = window.setInterval(() => {
    if (state.previewStage >= 3) return;
    state.previewStage += 1;
    state.previewSnapshot = previewSnapshot(state.previewStage, state.startedAt);
    renderCall();
  }, 6_000);
}

const previewTurns = [
  ["bank", "Banco Central", "Buenas tardes, llamo del área de seguridad. Detectamos una compra inusual en su tarjeta.", 12_000],
  ["you", "María", "No reconozco esa compra. ¿Qué tengo que hacer?", 27_000],
  ["bank", "Banco Central", "Debemos bloquearla en los próximos cinco minutos o el cargo quedará aprobado.", 43_000],
  ["bank", "Banco Central", "Por seguridad, no cuelgue ni abra la aplicación mientras hacemos la reversión.", 66_000],
  ["you", "María", "Está bien, dígame.", 82_000],
  ["bank", "Banco Central", "Le acaba de llegar un código de seis dígitos. Léamelo para confirmar que usted es la titular.", 104_000],
] as const;

function previewSnapshot(stage: number, startedAt: number): CallSnapshot {
  const profiles: RiskProfile[] = [
    {
      risk: "low",
      score: 24,
      headline: "The caller is establishing a bank security pretext.",
      signals: [],
      advice: "Ask for a case number and verify it through the number on your card.",
      changed: "First simulated assessment; there is not enough evidence to call this fraudulent.",
    },
    {
      risk: "elevated",
      score: 61,
      headline: "Urgency and isolation are narrowing your choices.",
      signals: [
        { type: "urgency", quote: "en los próximos cinco minutos", why: "The caller imposes an artificial deadline before a charge is supposedly approved." },
        { type: "isolation", quote: "no cuelgue ni abra la aplicación", why: "They discourage independent verification through the bank's official channel." },
      ],
      advice: "Do not follow the caller's instructions. Hang up and call the number printed on your card.",
      changed: "Risk rose after the caller added a five-minute deadline and told María not to verify the claim.",
    },
    {
      risk: "high",
      score: 86,
      headline: "The caller is now requesting an authentication code.",
      signals: [
        { type: "urgency", quote: "en los próximos cinco minutos", why: "The deadline pressures María to act before checking the story." },
        { type: "isolation", quote: "no cuelgue ni abra la aplicación", why: "The caller tries to prevent verification through trusted channels." },
        { type: "credential-request", quote: "Léamelo para confirmar", why: "A one-time code can authorize access or a transaction; legitimate bank staff should not ask for it." },
      ],
      advice: "Do not share the code. End the call and contact your bank through its official app or card number.",
      changed: "Risk jumped because the caller requested the six-digit code after applying urgency and isolation pressure.",
    },
    {
      risk: "high",
      score: 94,
      headline: "This matches a credential theft sequence.",
      signals: [
        { type: "authority-claim", quote: "llamo del área de seguridad", why: "The caller claims institutional authority without a verifiable reference." },
        { type: "urgency", quote: "en los próximos cinco minutos", why: "The deadline creates pressure to bypass careful checking." },
        { type: "isolation", quote: "no cuelgue ni abra la aplicación", why: "The caller explicitly blocks independent verification." },
        { type: "credential-request", quote: "código de seis dígitos", why: "The requested one-time code may authorize a login or transaction." },
      ],
      advice: "End the call now. Do not share the code, and report the attempt through your bank's official channel.",
      changed: "The combined sequence now strongly supports a credential theft attempt.",
    },
  ];
  const profile = profiles[Math.min(stage, profiles.length - 1)]!;
  const turnCount = stage === 0 ? 2 : stage === 1 ? 4 : stage === 2 ? 6 : 6;
  return {
    version: 1,
    type: "session.snapshot",
    roomName: "demo-preview",
    sequence: stage + 1,
    startedAt,
    updatedAt: Date.now(),
    status: stage >= 2 ? "analyzing" : "listening",
    detail: stage >= 2 ? "Simulated monitor analyzed the latest request" : "Simulated monitor is following the conversation",
    participants: [
      { id: "you", name: "María", role: "subject", level: stage % 2 ? 0.18 : 0.42, hasAudio: true, consented: true },
      { id: "bank", name: "Banco Central", role: "counterparty", level: stage % 2 ? 0.66 : 0.31, hasAudio: true, consented: true },
    ],
    turns: previewTurns.slice(0, turnCount).map(([speakerId, speakerName, text, at], index) => ({
      id: `preview-${index + 1}`,
      speakerId,
      speakerName,
      text,
      at,
    })),
    profile,
  };
}

ui.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.setupMode === "recorded") void prepareRecordedCall();
  else void joinLiveCall();
});
for (const choice of document.querySelectorAll<HTMLInputElement>('input[name="callMode"]')) {
  choice.addEventListener("change", () => {
    if (!choice.checked) return;
    state.setupMode = choice.value === "recorded" ? "recorded" : "live";
    if (state.setupMode === "recorded" && ui.roomName.value === "demo") ui.roomName.value = "audio-demo";
    if (state.setupMode === "live" && ui.roomName.value === "audio-demo") ui.roomName.value = "demo";
    ui.consent.checked = false;
    setError(ui.setupError);
    renderSetupMode();
  });
}
ui.previewButton.addEventListener("click", beginPreview);
ui.leaveButton.addEventListener("click", () => {
  if (state.mode === "recorded") void exitRecordedCall();
  else showSetup();
});
ui.startRecordings.addEventListener("click", () => void startRecordedCall());
ui.stopRecordings.addEventListener("click", () => void exitRecordedCall());
ui.replayRecordings.addEventListener("click", () => void replayRecordedCall());
ui.copyRoomLink.addEventListener("click", async () => {
  if ((state.mode !== "live" && state.mode !== "recorded") || !ROOM_NAME_PATTERN.test(state.roomName)) return;
  try {
    await navigator.clipboard.writeText(browserRoomLink(state.roomName));
    setText(ui.copyRoomLink, "Link copied");
    window.setTimeout(() => setText(ui.copyRoomLink, "Copy room link"), 2_000);
  } catch {
    setText(ui.copyRoomLink, "Copy unavailable");
    window.setTimeout(() => setText(ui.copyRoomLink, "Copy room link"), 2_000);
  }
});
ui.muteButton.addEventListener("click", async () => {
  if (state.mode !== "live" || !state.room) return;
  setError(ui.callError);
  try {
    await state.room.localParticipant.setMicrophoneEnabled(!state.room.localParticipant.isMicrophoneEnabled);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(ui.callError, `The microphone could not change state: ${message}. Check this site's microphone permission.`);
  }
  renderCall();
});
ui.audioButton.addEventListener("click", async () => {
  if (!state.room) return;
  try {
    await state.room.startAudio();
    setError(ui.callError);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(ui.callError, `Browser audio is still blocked: ${message}. Allow sound for this site and try again.`);
  }
  renderAudioControl();
});
ui.recordedAudioButton.addEventListener("click", async () => {
  if (!state.room) return;
  try {
    await state.room.startAudio();
    setError(ui.callError);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(ui.callError, `Observer audio is still blocked: ${message}. Allow sound for this site and try again.`);
  }
  renderAudioControl();
});
window.addEventListener("beforeunload", () => {
  void state.recordedPlayback?.stop();
  state.room?.disconnect();
});

const requestedRoom = new URL(window.location.href).searchParams.get("room")?.trim();
if (requestedRoom && ROOM_NAME_PATTERN.test(requestedRoom)) ui.roomName.value = requestedRoom;

renderSetupMode();
void loadHealth();
