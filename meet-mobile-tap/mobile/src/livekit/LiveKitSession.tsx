import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  useTrackVolume,
  type TrackReferenceOrPlaceholder,
} from "@livekit/react-native";
import { ConnectionState, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { MONITOR_IDENTITY } from "../../../shared/session";
import { acceptRoomSnapshot, initialRoomSession } from "../../../shared/room-session";
import { CallScreen } from "../screens/CallScreen";
import { C, styles } from "../styles";
import type { ConnectionStatus, GatewayState } from "../gateway/reducer";
import { projectRoomSession } from "./room-adapter";

export function LiveKitSession({
  roomName,
  role,
  assistantEnabled,
  error,
  onConnected,
  onState,
  onEnd,
}: {
  roomName: string;
  role: "subject" | "counterparty";
  assistantEnabled: boolean;
  error?: string;
  onConnected: () => void;
  onState: (state: GatewayState) => void;
  onEnd: (state: GatewayState) => Promise<void>;
}) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants().filter(
    (participant) => participant.identity !== MONITOR_IDENTITY,
  );
  const tracks = useTracks([Track.Source.Microphone]);
  const [roomSession, setRoomSession] = useState(initialRoomSession);
  const initialProjectionRef = useRef(
    projectRoomSession(undefined, initialRoomSession(), "connecting"),
  );
  const projectedRef = useRef(initialProjectionRef.current);
  const [projected, setProjected] = useState<GatewayState>(initialProjectionRef.current);
  const [now, setNow] = useState(Date.now);
  const [micBusy, setMicBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const connectedAtRef = useRef<number | null>(null);

  const hasConnected = connectedAtRef.current !== null;
  const mobileConnection = connectionStatus(connection, hasConnected);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (connection === ConnectionState.Connected && connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
      onConnected();
    }
  }, [connection, onConnected]);

  useEffect(() => {
    const handleData = (
      payload: Uint8Array,
      participant: RemoteParticipant | undefined,
      _kind: unknown,
      topic?: string,
    ) => {
      setRoomSession((current) => acceptRoomSnapshot(current, {
        payload,
        senderIdentity: participant?.identity,
        topic,
        roomName,
      }));
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, roomName]);

  useEffect(() => {
    const projectionTime = Math.max(Date.now(), roomSession.receivedAt ?? 0);
    const next = projectRoomSession(projectedRef.current, roomSession, mobileConnection, projectionTime);
    projectedRef.current = next;
    onState(next);
    setProjected(next);
  }, [mobileConnection, now, onState, roomSession]);

  const muted = !localParticipant.isMicrophoneEnabled;
  const toggleMic = useCallback(async () => {
    if (connection !== ConnectionState.Connected || micBusy) return;
    setActionError(undefined);
    setMicBusy(true);
    try {
      await localParticipant.setMicrophoneEnabled(muted);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not change the microphone state.");
    } finally {
      setMicBusy(false);
    }
  }, [connection, localParticipant, micBusy, muted]);

  const endCall = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    setActionError(undefined);
    try {
      await room.disconnect();
      await onEnd(projected);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not leave the room cleanly.");
      setLeaving(false);
    }
  }, [leaving, onEnd, projected, room]);

  const elapsed = connectedAtRef.current === null
    ? 0
    : Math.max(0, Math.floor((now - connectedAtRef.current) / 1_000));
  const status = callStatus(connection, participants.length, hasConnected);

  const livePanel = (
    <View style={local.panel}>
      <View style={styles.rowBetween}>
        <View style={local.statusCopy}>
          <View style={styles.row}>
            <View style={[local.dot, { backgroundColor: status.color }]} />
            <Text style={local.status}>{status.title}</Text>
          </View>
          <Text style={styles.small}>{status.detail}</Text>
          <Text style={local.roomName}>
            Room · {roomName} · {role === "subject" ? "Protected person" : "Other caller"}
          </Text>
        </View>
        {connection === ConnectionState.Connected ? (
          <Text style={local.timer}>{formatDuration(elapsed)}</Text>
        ) : (
          <ActivityIndicator size="small" color={C.faint} />
        )}
      </View>

      {actionError || error ? <Text style={local.error}>{actionError ?? error}</Text> : null}

      <View style={local.peopleContent}>
        {participants.map((participant) => {
          const track = tracks.find((candidate) => candidate.participant.identity === participant.identity);
          return (
            <ParticipantMeter
              key={participant.identity}
              name={participant.name || participant.identity}
              isLocal={participant.isLocal}
              muted={participant.isMicrophoneEnabled === false}
              track={track}
            />
          );
        })}
      </View>

      <View style={local.controls}>
        <Pressable
          accessibilityRole="button"
          disabled={connection !== ConnectionState.Connected || micBusy || leaving}
          onPress={() => void toggleMic()}
          style={[styles.secondary, local.control]}
        >
          {micBusy ? <ActivityIndicator size="small" color={C.text} /> : null}
          <Text style={styles.secondaryLabel}>{muted ? "Unmute" : "Mute"}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <CallScreen
      transport="livekit"
      state={projected}
      livePanel={livePanel}
      assistantEnabled={assistantEnabled}
      ending={leaving}
      onEndCall={() => void endCall()}
    />
  );
}

function ParticipantMeter({
  name,
  isLocal,
  muted,
  track,
}: {
  name: string;
  isLocal: boolean;
  muted: boolean;
  track?: TrackReferenceOrPlaceholder;
}) {
  return (
    <View style={local.person}>
      <View style={local.personHeading}>
        <Text numberOfLines={1} style={local.personName}>{name}{isLocal ? " · you" : ""}</Text>
        <Text style={styles.small}>{muted ? "Muted" : track ? "Mic live" : "No audio"}</Text>
      </View>
      {track ? <VolumeMeter track={track} /> : <View style={local.track} />}
    </View>
  );
}

function VolumeMeter({ track }: { track: TrackReferenceOrPlaceholder }) {
  const volume = useTrackVolume(track);
  const percent = Math.min(100, Math.max(0, Math.round(volume * 100)));
  return (
    <View
      accessible
      accessibilityLabel={`${track.participant.identity} audio level ${percent} percent`}
      style={local.track}
    >
      <View style={[local.fill, { width: `${percent}%` }]} />
    </View>
  );
}

function connectionStatus(connection: ConnectionState, hasConnected: boolean): ConnectionStatus {
  if (connection === ConnectionState.Connected) return "open";
  if (
    connection === ConnectionState.Reconnecting ||
    connection === ConnectionState.SignalReconnecting
  ) return "reconnecting";
  if (connection === ConnectionState.Disconnected) return hasConnected ? "closed" : "connecting";
  return "connecting";
}

function callStatus(connection: ConnectionState, participantCount: number, hasConnected: boolean) {
  if (
    connection === ConnectionState.Reconnecting ||
    connection === ConnectionState.SignalReconnecting
  ) return { title: "Reconnecting", detail: "Audio and current guidance are paused.", color: C.elevated };
  if (connection === ConnectionState.Connected && participantCount <= 1) {
    return { title: "Waiting for another caller", detail: "Share the room name with the other participant.", color: C.elevated };
  }
  if (connection === ConnectionState.Connected) {
    return { title: "Call in progress", detail: `${participantCount} people connected`, color: C.accent };
  }
  if (connection === ConnectionState.Disconnected) {
    return hasConnected
      ? { title: "Call ended", detail: "The room connection is closed.", color: C.faint }
      : { title: "Connecting securely", detail: "Opening the room and microphone…", color: C.elevated };
  }
  return { title: "Connecting securely", detail: "Opening the room and microphone…", color: C.elevated };
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const local = StyleSheet.create({
  panel: { gap: 12, paddingVertical: 2 },
  statusCopy: { flex: 1, gap: 3 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: C.text, fontSize: 16, fontWeight: "700" },
  roomName: { color: C.accent, fontSize: 12, fontWeight: "700" },
  timer: { color: C.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  error: { color: C.danger, fontSize: 13, lineHeight: 18 },
  peopleContent: { gap: 12 },
  person: { gap: 6 },
  personHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  personName: { flex: 1, color: C.text, fontSize: 13, fontWeight: "600" },
  track: { height: 5, borderRadius: 3, backgroundColor: C.ground, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3, backgroundColor: C.accent },
  controls: { flexDirection: "row" },
  control: { minWidth: 110, flexDirection: "row", gap: 8 },
});
