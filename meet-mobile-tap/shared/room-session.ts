/** Client-side receipt and freshness rules shared by the browser and native app. */
import {
  MONITOR_IDENTITY,
  SESSION_TOPIC,
  parseCallSnapshot,
  type CallSnapshot,
  type RiskProfile,
} from "./session.ts";

export const ROOM_STALE_AFTER_MS = 15_000;
const MAX_PACKET_BYTES = 200_000;

export type RoomSessionState = {
  snapshot: CallSnapshot | null;
  /** Local receipt time: freshness must not depend on the phone's clock matching the server. */
  receivedAt: number | null;
};

export function initialRoomSession(): RoomSessionState {
  return { snapshot: null, receivedAt: null };
}

export type RoomPublication = {
  payload: Uint8Array | string;
  senderIdentity: string | undefined;
  topic: string | undefined;
  roomName: string;
};

/** Full snapshots replace the current window; packet gaps do not imply missing events. */
export function acceptRoomSnapshot(
  state: RoomSessionState,
  publication: RoomPublication,
  now = Date.now(),
): RoomSessionState {
  if (publication.senderIdentity !== MONITOR_IDENTITY || publication.topic !== SESSION_TOPIC ||
    publication.payload.length > MAX_PACKET_BYTES || !Number.isFinite(now)) return state;

  let raw: string;
  try {
    raw = typeof publication.payload === "string" ? publication.payload :
      new TextDecoder().decode(publication.payload);
  } catch { return state; }

  const snapshot = parseCallSnapshot(raw);
  if (!snapshot || snapshot.roomName !== publication.roomName) return state;

  const previous = state.snapshot;
  if (previous) {
    // A new monitor instance starts a new sequence. Old-instance packets must
    // never overwrite it after reconnecting or rejoining the same named room.
    if (snapshot.startedAt < previous.startedAt) return state;
    if (snapshot.startedAt === previous.startedAt &&
      (snapshot.sequence <= previous.sequence || snapshot.updatedAt < previous.updatedAt ||
       previous.status === "ended")) return state;
  }
  return { snapshot, receivedAt: now };
}

/** Callers also suppress the current profile while their RTC connection is down. */
export function currentRoomProfile(state: RoomSessionState, now = Date.now()): RiskProfile | null {
  const { snapshot, receivedAt } = state;
  if (!snapshot || receivedAt === null || !Number.isFinite(now) || now < receivedAt ||
    now - receivedAt > ROOM_STALE_AFTER_MS ||
    (snapshot.status !== "listening" && snapshot.status !== "analyzing")) return null;
  return snapshot.profile;
}
