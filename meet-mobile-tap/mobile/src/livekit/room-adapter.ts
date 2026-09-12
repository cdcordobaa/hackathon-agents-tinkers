import {
  ROOM_STALE_AFTER_MS,
  currentRoomProfile,
  type RoomSessionState,
} from "../../../shared/room-session";
import type { CallSnapshot, RiskProfile } from "../../../shared/session";
import {
  initialGatewayState,
  type ConnectionStatus,
  type GatewayState,
  type TranscriptTurn,
} from "../gateway/reducer";

function higherRisk(current: RiskProfile | undefined, candidate: RiskProfile | null) {
  if (!candidate || (current && current.score > candidate.score)) return current;
  return candidate;
}

function mergeTurns(previous: TranscriptTurn[], snapshot: CallSnapshot | null): TranscriptTurn[] {
  if (!snapshot) return previous;
  const participants = new Map(snapshot.participants.map((participant) => [participant.id, participant]));
  const known = new Set(previous.flatMap((turn) => turn.sourceId ? [turn.sourceId] : []));
  let seq = previous.reduce((maximum, turn) => Math.max(maximum, turn.seq), 0);
  const additions: TranscriptTurn[] = [];

  for (const turn of snapshot.turns) {
    const sourceId = `${snapshot.startedAt}:${turn.id}`;
    if (known.has(sourceId)) continue;
    known.add(sourceId);
    const participant = participants.get(turn.speakerId);
    additions.push({
      seq: ++seq,
      sourceId,
      atMs: turn.at,
      speakerId: turn.speakerId,
      speakerLabel: turn.speakerName,
      role: participant?.role ?? "unknown",
      text: turn.text,
    });
  }
  return [...previous, ...additions].slice(-500);
}

/** Project trusted full-room snapshots into the incumbent mobile view model. */
export function projectRoomSession(
  previous: GatewayState | undefined,
  room: RoomSessionState,
  connection: ConnectionStatus,
  now = Date.now(),
): GatewayState {
  const base = previous ?? initialGatewayState();
  const snapshot = room.snapshot;
  const current = connection === "open" ? currentRoomProfile(room, now) : null;
  const observed = snapshot?.profile ?? null;
  const stale = Boolean(
    snapshot && room.receivedAt !== null && now - room.receivedAt > ROOM_STALE_AFTER_MS,
  );
  const degraded: GatewayState["degraded"] = snapshot?.status === "degraded"
    ? {
        monitor: {
          speakerId: "monitor",
          reason: snapshot.detail || "Live analysis is temporarily unavailable.",
          atMs: snapshot.updatedAt - snapshot.startedAt,
        },
      }
    : stale
      ? {
          monitor: {
            speakerId: "monitor",
            reason: "Live analysis is stale. Current risk and advice are hidden until monitoring resumes.",
            atMs: snapshot ? snapshot.updatedAt - snapshot.startedAt : 0,
          },
        }
      : {};

  return {
    ...base,
    sessionId: snapshot?.roomName,
    connection,
    backlogGap: false,
    sessionState: snapshot?.status === "ended" ? "ended" : "running",
    transport: "livekit",
    lastSeq: snapshot?.sequence,
    profile: current ?? undefined,
    peak: higherRisk(base.peak, observed),
    lastPass: undefined,
    turns: mergeTurns(base.turns, snapshot),
    degraded,
  };
}
