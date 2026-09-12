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

type AppMode = "setup" | "live" | "preview";
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
  roomName: element<HTMLInputElement>("room-name"),
  displayName: element<HTMLInputElement>("display-name"),
  role: element<HTMLSelectElement>("role"),
  consent: element<HTMLInputElement>("consent"),
  setupError: element<HTMLElement>("setup-error"),
  previewButton: element<HTMLButtonElement>("preview-button"),
  previewBanner: element<HTMLElement>("preview-banner"),
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
  health: Health | null;
  attachedTracks: Map<string, { track: RemoteTrack; audio: HTMLAudioElement; participantId: string }>;
} = {
  mode: "setup",
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
    if (state.mode !== "live") return;
    showSetup("The live call ended. You can rejoin when the room is ready.");
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
  ui.joinButton.firstElementChild!.textContent = "Joining…";

  const identity = safeIdentity(displayName);
  try {
    const response = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ roomName, identity, displayName, role, consent: true }),
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
    if (value.monitorIdentity !== MONITOR_IDENTITY) throw new Error("The server returned an unexpected monitor identity.");

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
    ui.joinButton.firstElementChild!.textContent = "Join live call";
  }
}

function showCallView(): void {
  ui.setupView.hidden = true;
  ui.callView.hidden = false;
  ui.previewBanner.hidden = state.mode !== "preview";
  ui.environmentBadge.hidden = false;
  ui.environmentBadge.className = `environment-badge ${state.mode === "preview" ? "preview" : "live"}`;
  setText(ui.environmentBadge, state.mode === "preview" ? "Simulated preview" : "Live room");
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
  detachAllAudio();
  const room = state.room;
  state.room = undefined;
  if (room && room.state !== ConnectionState.Disconnected) room.disconnect();
  state.roomSession = initialRoomSession();
  state.previewSnapshot = null;
  state.lastRenderedFreshness = null;
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
  const currentFreshness = snapshotIsCurrent();
  if (activeSnapshot() && currentFreshness !== state.lastRenderedFreshness) renderCall();
}

function renderCall(): void {
  if (state.mode === "setup") return;
  const snapshot = activeSnapshot();
  const room = state.room;
  const isPreview = state.mode === "preview";
  const connected = isPreview || room?.state === ConnectionState.Connected;
  const visible = getVisibleParticipants();
  const monitorState = !snapshot ? "monitor waiting" : snapshotIsCurrent() ? snapshot.status : "monitor update stale";

  setText(ui.callTitle, connected ? snapshot?.status === "ended" ? "Call ended" : "Call in progress" : "Joining call…");
  setText(
    ui.callStateLine,
    isPreview
      ? "●  Simulated session playing"
      : connected
        ? `●  Live · ${monitorState}`
        : `●  ${room?.state ?? "connecting"}`,
  );
  setText(ui.roomSummary, `${state.roomName} · ${visible.length} ${visible.length === 1 ? "person" : "people"}`);
  setText(ui.shareRoomName, state.roomName);
  ui.roomShare.hidden = isPreview;
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

  ui.muteButton.disabled = isPreview || !connected;
  ui.leaveButton.disabled = false;
  setText(ui.leaveButton.lastElementChild as HTMLElement, isPreview ? "Exit preview" : "Leave");
  if (isPreview) {
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
  setText(ui.audioProof, movingAudio ? "Voice activity detected" : "Connected · waiting for voice activity");
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
  const role = person.role === "subject" ? "Protected caller" : person.role === "counterparty" ? "Other caller" : "Participant";
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
  const shouldShow = state.mode === "live" && Boolean(state.room) && !state.room!.canPlaybackAudio;
  ui.audioButton.hidden = !shouldShow;
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
  const profile = state.mode === "preview"
    ? snapshot?.profile ?? null
    : state.room?.state === ConnectionState.Connected ? currentRoomProfile(state.roomSession, now) : null;
  const degraded = snapshot?.status === "degraded";
  const ended = snapshot?.status === "ended";

  renderFreshness();
  if (!snapshot) {
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
    if (ended) {
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
  renderRisk(profile);
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

function renderRisk(profile: RiskProfile): void {
  const visualRisk = profile.risk === "none" ? "low" : profile.risk;
  ui.riskDisplay.className = `risk-display risk-${visualRisk}`;
  setText(ui.riskBand, profile.risk === "none" ? "No risk found" : `${titleCase(profile.risk)} risk`);
  setText(ui.riskScore, String(profile.score));
  setText(ui.riskHeadline, profile.headline);
  setText(ui.riskChange, profile.changed);
  ui.riskScaleFill.style.transform = `scaleX(${profile.score / 100})`;
  setText(ui.riskAdvice, profile.advice || "No action is recommended from the current evidence.");
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
  void joinLiveCall();
});
ui.previewButton.addEventListener("click", beginPreview);
ui.leaveButton.addEventListener("click", () => showSetup());
ui.copyRoomLink.addEventListener("click", async () => {
  if (state.mode !== "live" || !ROOM_NAME_PATTERN.test(state.roomName)) return;
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
window.addEventListener("beforeunload", () => state.room?.disconnect());

const requestedRoom = new URL(window.location.href).searchParams.get("room")?.trim();
if (requestedRoom && ROOM_NAME_PATTERN.test(requestedRoom)) ui.roomName.value = requestedRoom;

void loadHealth();
