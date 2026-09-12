/**
 * The original App.tsx, kept: join, mute, a live level meter per
 * participant. Per this task's instructions, LiveKit stays a call-only rung
 * with no transcript in this pass — the gateway session (risk HUD,
 * transcript, signals) runs independently of this panel. Choosing the
 * `livekit` transport shows both side by side; the gateway will not have a
 * transcript source behind it, which is why the risk HUD stays in its
 * "analysing" / no-data state on this path (see CallScreen.tsx) rather than
 * silently faking a result.
 *
 * The live meter is not decoration. Per ../../CLAUDE.md, silence is the
 * expected failure mode on mobile and looks exactly like success, so the
 * first thing this panel has to prove is that non-zero audio is moving.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  useConnectionState,
  useLocalParticipant,
  useTracks,
  useTrackVolume,
  type TrackReferenceOrPlaceholder,
} from "@livekit/react-native";
import { ConnectionState, Track } from "livekit-client";
import { C, styles } from "../styles";

const SERVER_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL;
const TOKEN = process.env.EXPO_PUBLIC_LIVEKIT_TOKEN;

export function LiveKitCallPanel() {
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string>();

  // The native audio session has to be running before any track is
  // published, on both platforms. Starting it on mount rather than on join
  // keeps the first connection from racing it.
  useEffect(() => {
    let cancelled = false;
    AudioSession.startAudioSession().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      void AudioSession.stopAudioSession();
    };
  }, []);

  const configured = Boolean(SERVER_URL && TOKEN);

  if (!configured) {
    return (
      <View style={styles.card}>
        <Text style={styles.subtitle}>No LiveKit credentials</Text>
        <Text style={styles.body}>
          Create a .env next to mobile/package.json with EXPO_PUBLIC_LIVEKIT_URL and
          EXPO_PUBLIC_LIVEKIT_TOKEN, then restart the bundler with --clear.
        </Text>
        <Text style={styles.code}>npm run token -- --room demo --identity phone</Text>
      </View>
    );
  }

  if (!joined) {
    return (
      <View style={styles.card}>
        <Text style={styles.subtitle}>Join the call audio</Text>
        <Text style={styles.body}>
          Opens a real WebRTC call. Bring a second participant in from a browser or another phone,
          then watch both meters move.
        </Text>
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
        <Pressable style={styles.primary} onPress={() => setJoined(true)}>
          <Text style={styles.primaryLabel}>Join</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={SERVER_URL}
      token={TOKEN}
      audio={true}
      video={false}
      connect={true}
      onDisconnected={() => setJoined(false)}
      onError={(cause) => setError(cause.message)}
    >
      <LiveKitConnectedPanel onLeave={() => setJoined(false)} error={error} />
    </LiveKitRoom>
  );
}

function LiveKitConnectedPanel({ onLeave, error }: { onLeave: () => void; error?: string }) {
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const micTracks = useTracks([Track.Source.Microphone]);
  const connecting = connection === ConnectionState.Connecting;

  const toggleMic = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
  }, [localParticipant]);

  return (
    <View style={[styles.card, { gap: 10 }]}>
      <View style={styles.rowBetween}>
        <View style={styles.row}>
          <View style={[local.dot, connection === ConnectionState.Connected && local.dotLive]} />
          <Text style={local.status}>{connection}</Text>
          {connecting ? <ActivityIndicator size="small" color={C.faint} /> : null}
        </View>
        <Pressable style={styles.secondary} onPress={toggleMic}>
          <Text style={styles.secondaryLabel}>{localParticipant.isMicrophoneEnabled ? "Mute" : "Unmute"}</Text>
        </Pressable>
      </View>

      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}

      <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 14 }}>
        {micTracks.length === 0 ? (
          <Text style={styles.small}>
            No microphones published yet. If this persists after connecting, the mic permission was
            denied or the audio session failed to start.
          </Text>
        ) : (
          micTracks.map((trackRef) => (
            <MicMeter
              key={`${trackRef.participant.identity}:${trackRef.publication?.trackSid ?? "mic"}`}
              trackRef={trackRef}
            />
          ))
        )}
      </ScrollView>

      <Pressable style={[styles.secondary, { borderColor: C.danger }]} onPress={onLeave}>
        <Text style={[styles.secondaryLabel, { color: C.danger }]}>Leave call audio</Text>
      </Pressable>
    </View>
  );
}

/** useTrackVolume returns 0-1 sampled from the actual media track, so a bar
 *  that never leaves zero means no audio is reaching us — which is the
 *  failure this panel exists to make visible. */
function MicMeter({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const volume = useTrackVolume(trackRef);
  const isLocal = trackRef.participant.isLocal;
  const percent = Math.min(100, Math.round(volume * 100));

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.rowBetween}>
        <Text style={local.who}>
          {trackRef.participant.identity}
          {isLocal ? " (you)" : ""}
        </Text>
        <Text style={local.level}>{percent}</Text>
      </View>
      <View style={local.track}>
        <View style={[local.fill, { width: `${percent}%` }, isLocal && local.fillLocal]} />
      </View>
    </View>
  );
}

const local = {
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.faint },
  dotLive: { backgroundColor: C.accent },
  status: {
    color: C.faint,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
    fontWeight: "600" as const,
  },
  who: { color: C.text, fontSize: 14, fontWeight: "600" as const },
  level: { color: C.faint, fontFamily: "Menlo", fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: C.ground, overflow: "hidden" as const },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
  fillLocal: { backgroundColor: C.accentStrong },
};
