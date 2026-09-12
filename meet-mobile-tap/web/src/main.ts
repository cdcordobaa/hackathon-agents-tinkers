/**
 * The operator screen. Wires together:
 *   config.ts               -> the input panel (persisted to localStorage)
 *   livekit/room.ts          -> join the room, discover participant tracks
 *   participant-pipeline.ts  -> per-participant level meter + transcription
 *   gateway/session-client.ts -> drive the gateway session to `running`
 *   gateway/transcript-poster.ts -> batch-POST segments, with retry/backoff
 *   script-pane.ts           -> the caller's script, read verbatim
 *
 * This file only does DOM plumbing — every piece of actual logic lives in
 * the module that owns it, listed above.
 */
import { ConnectionState } from "livekit-client";
import { loadConfig, saveConfig, type AppConfig } from "./config.ts";
import { joinRoom, type ParticipantAudio, type RoomHandle } from "./livekit/room.ts";
import { startParticipantPipeline, type ParticipantPipelineHandle } from "./participant-pipeline.ts";
import { openGatewaySession, type SessionHandle } from "./gateway/session-client.ts";
import { TranscriptPoster, type PostStats } from "./gateway/transcript-poster.ts";
import { renderScriptPane } from "./script-pane.ts";
import type { SessionState } from "../../shared/src/index.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  roomState: $<HTMLSpanElement>("room-state"),
  sessionState: $<HTMLSpanElement>("session-state"),
  lkUrl: $<HTMLInputElement>("lk-url"),
  lkToken: $<HTMLInputElement>("lk-token"),
  lkRoom: $<HTMLInputElement>("lk-room"),
  lkIdentity: $<HTMLInputElement>("lk-identity"),
  gwUrl: $<HTMLInputElement>("gw-url"),
  tsUrl: $<HTMLInputElement>("ts-url"),
  joinBtn: $<HTMLButtonElement>("join-btn"),
  leaveBtn: $<HTMLButtonElement>("leave-btn"),
  consentBtn: $<HTMLButtonElement>("consent-btn"),
  setupError: $<HTMLParagraphElement>("setup-error"),
  participants: $<HTMLDivElement>("participants"),
  transcript: $<HTMLDivElement>("transcript"),
  scriptPane: $<HTMLDivElement>("script-pane"),
  statPosted: $<HTMLSpanElement>("stat-posted"),
  statFailed: $<HTMLSpanElement>("stat-failed"),
  statPending: $<HTMLSpanElement>("stat-pending"),
  statError: $<HTMLParagraphElement>("stat-error"),
};

renderScriptPane(els.scriptPane);

function applyConfigToInputs(config: AppConfig): void {
  els.lkUrl.value = config.livekitUrl;
  els.lkToken.value = config.livekitToken;
  els.lkRoom.value = config.room;
  els.lkIdentity.value = config.identity;
  els.gwUrl.value = config.gatewayUrl;
  els.tsUrl.value = config.tokenServerUrl;
}

function readConfigFromInputs(): AppConfig {
  return {
    livekitUrl: els.lkUrl.value.trim(),
    livekitToken: els.lkToken.value.trim(),
    room: els.lkRoom.value.trim() || "demo",
    identity: els.lkIdentity.value.trim() || "browser",
    gatewayUrl: els.gwUrl.value.trim().replace(/\/$/, ""),
    tokenServerUrl: els.tsUrl.value.trim().replace(/\/$/, ""),
  };
}

applyConfigToInputs(loadConfig());

function setBadge(el: HTMLElement, text: string, tone: "idle" | "good" | "warn" | "bad"): void {
  el.textContent = text;
  el.className = `badge badge-${tone}`;
}

function showError(el: HTMLElement, message: string | undefined): void {
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

// ---- participant rows -------------------------------------------------

type ParticipantRow = {
  row: HTMLDivElement;
  levelFill: HTMLDivElement;
  statusEl: HTMLSpanElement;
};

const participantRows = new Map<string, ParticipantRow>();
const pipelines = new Map<string, ParticipantPipelineHandle>();
// The transcript line currently showing a speaker's in-progress (non-final)
// text — replaced in place on each delta, exactly like RollingTranscript's
// own delta()/final() rule, so the operator screen never shows text that was
// itself only ever a draft.
const interimLines = new Map<string, HTMLDivElement>();

function ensureParticipantRow(identity: string, role: "subject" | "counterparty"): ParticipantRow {
  const existing = participantRows.get(identity);
  if (existing) return existing;

  const row = document.createElement("div");
  row.className = "participant";

  const name = document.createElement("div");
  name.innerHTML = `<div class="participant-name">${identity}</div><div class="participant-role">${role}</div>`;

  const levelTrack = document.createElement("div");
  levelTrack.className = "level-track";
  const levelFill = document.createElement("div");
  levelFill.className = "level-fill";
  levelTrack.appendChild(levelFill);

  const statusEl = document.createElement("span");
  statusEl.className = "participant-status status-connecting";
  statusEl.textContent = "connecting…";

  row.appendChild(name);
  row.appendChild(levelTrack);
  row.appendChild(statusEl);
  els.participants.appendChild(row);

  const created: ParticipantRow = { row, levelFill, statusEl };
  participantRows.set(identity, created);
  return created;
}

function setParticipantStatus(identity: string, status: "ok" | "degraded" | "connecting", detail?: string): void {
  const row = participantRows.get(identity);
  if (!row) return;
  row.statusEl.className = `participant-status status-${status}`;
  row.statusEl.textContent = status === "ok" ? "transcribing" : status === "degraded" ? `degraded${detail ? `: ${detail}` : ""}` : "connecting…";
}

function setParticipantLevel(identity: string, level: number): void {
  const row = participantRows.get(identity);
  if (!row) return;
  // RMS of PCM16-range floats sits well under 1; scale up so a normal
  // speaking voice actually moves the bar instead of sitting near zero.
  const pct = Math.min(100, Math.round(level * 350));
  row.levelFill.style.width = `${pct}%`;
}

// ---- transcript --------------------------------------------------------

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
}

function renderTranscriptLine(identity: string, role: string, text: string, isFinal: boolean, atMs: number): void {
  let lineEl = isFinal ? undefined : interimLines.get(identity);
  if (!lineEl) {
    lineEl = document.createElement("div");
    els.transcript.appendChild(lineEl);
    if (!isFinal) interimLines.set(identity, lineEl);
  }
  if (isFinal) interimLines.delete(identity);

  lineEl.className = `line${isFinal ? "" : " interim"}`;
  lineEl.innerHTML = `<span class="clock">${formatClock(atMs)}</span><span class="speaker">${identity} (${role})</span>: ${escapeHtml(text)}`;
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ---- ingest stats --------------------------------------------------------

function renderStats(stats: Readonly<PostStats>): void {
  els.statPosted.textContent = String(stats.posted);
  els.statFailed.textContent = String(stats.failedAttempts);
  els.statPending.textContent = String(stats.pending);
  showError(els.statError, stats.lastError);
}

// ---- session state -------------------------------------------------------

const SESSION_TONE: Record<SessionState, "idle" | "good" | "warn" | "bad"> = {
  idle: "idle",
  "awaiting-consent": "warn",
  running: "good",
  ending: "warn",
  ended: "idle",
};

// ---- connect / disconnect -------------------------------------------------

let roomHandle: RoomHandle | undefined;
let sessionHandle: SessionHandle | undefined;
let poster: TranscriptPoster | undefined;
let sessionClockStart = 0;

function atMs(): number {
  return performance.now() - sessionClockStart;
}

async function handleParticipantAudio(config: AppConfig, audio: ParticipantAudio): Promise<void> {
  if (pipelines.has(audio.identity)) return; // already tapped (e.g. a republish)
  const role = audio.isLocal ? "subject" : "counterparty";
  ensureParticipantRow(audio.identity, role);

  const pipeline = await startParticipantPipeline({
    identity: audio.identity,
    isLocal: audio.isLocal,
    track: audio.track,
    tokenServerUrl: config.tokenServerUrl,
    atMs,
    onLevel: (level) => setParticipantLevel(audio.identity, level),
    onTranscript: ({ text, isFinal }) => renderTranscriptLine(audio.identity, role, text, isFinal, atMs()),
    onSegment: (segment) => poster?.enqueue(segment),
    onDegraded: (reason) => setParticipantStatus(audio.identity, "degraded", reason),
  });
  pipelines.set(audio.identity, pipeline);
  setParticipantStatus(audio.identity, "ok");
}

function handleParticipantGone(identity: string): void {
  pipelines.get(identity)?.stop();
  pipelines.delete(identity);
  interimLines.delete(identity);
  setParticipantStatus(identity, "degraded", "left");
}

async function join(): Promise<void> {
  showError(els.setupError, undefined);
  const config = readConfigFromInputs();
  saveConfig(config);

  if (!config.livekitUrl || !config.livekitToken) {
    showError(els.setupError, "LiveKit URL and token are both required — mint one with `npm run token` (see README).");
    return;
  }

  els.joinBtn.disabled = true;
  try {
    sessionHandle = await openGatewaySession(config.gatewayUrl, "livekit", {
      onState: (state) => {
        setBadge(els.sessionState, `session: ${state}`, SESSION_TONE[state]);
        els.consentBtn.disabled = state !== "awaiting-consent";
      },
      onEvent: () => {
        /* transcript.turn / risk.updated are not rendered here — this
           screen's transcript comes straight from the local transcription
           sessions (see renderTranscriptLine); the WS is driven only far
           enough to clear the consent gate so posted segments are not
           silently discarded. */
      },
      onError: (message) => showError(els.setupError, message),
    });
    sessionClockStart = performance.now();
    poster = new TranscriptPoster(config.gatewayUrl, sessionHandle.id, sessionHandle.token, renderStats);
  } catch (cause) {
    showError(
      els.setupError,
      `Gateway session failed: ${cause instanceof Error ? cause.message : String(cause)}\n` +
        `(expected until the gateway's livekit ingest route exists — see web/README.md)`,
    );
    els.joinBtn.disabled = false;
    return;
  }

  try {
    roomHandle = await joinRoom(config.livekitUrl, config.livekitToken, {
      onConnectionState: (state) => {
        const tone = state === ConnectionState.Connected ? "good" : state === ConnectionState.Disconnected ? "bad" : "warn";
        setBadge(els.roomState, `room: ${state}`, tone);
      },
      onAudioTrack: (audio) => void handleParticipantAudio(config, audio),
      onAudioTrackEnded: (identity) => handleParticipantGone(identity),
      onRoster: () => {
        /* participant rows are created lazily from onAudioTrack — a
           roster change with no track yet (e.g. video-only join) needs no
           row on this screen. */
      },
      onError: (message) => showError(els.setupError, message),
    });
  } catch (cause) {
    showError(els.setupError, `LiveKit join failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    els.joinBtn.disabled = false;
    return;
  }

  els.leaveBtn.disabled = false;
}

async function leave(): Promise<void> {
  els.leaveBtn.disabled = true;
  for (const [identity] of pipelines) handleParticipantGone(identity);
  sessionHandle?.end();
  sessionHandle?.close();
  poster?.stop();
  await roomHandle?.disconnect();
  roomHandle = undefined;
  sessionHandle = undefined;
  poster = undefined;
  setBadge(els.roomState, "room: idle", "idle");
  setBadge(els.sessionState, "session: idle", "idle");
  els.joinBtn.disabled = false;
  els.consentBtn.disabled = true;
}

els.joinBtn.addEventListener("click", () => void join());
els.leaveBtn.addEventListener("click", () => void leave());
els.consentBtn.addEventListener("click", () => sessionHandle?.grantConsent());

window.addEventListener("beforeunload", () => {
  // Best-effort teardown so a closed tab does not leave the gateway session
  // (or the OpenAI Realtime sockets) waiting on a peer that is never coming
  // back. Not guaranteed to complete — browsers do not await work here.
  sessionHandle?.end();
});
