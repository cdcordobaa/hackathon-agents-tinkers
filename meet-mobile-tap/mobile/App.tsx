/**
 * A real call, on the phone, in React Native.
 *
 * No phone number and no telephony: a LiveKit room is WebRTC, so two clients
 * in the same room *is* a call. That sidesteps every wall in ../CLAUDE.md —
 * we are not eavesdropping on another app, we are a party to the call, so the
 * audio is ours to use.
 *
 * The live meter next to each participant is not decoration. Per ../CLAUDE.md,
 * silence is the expected failure mode on mobile and looks exactly like
 * success, so the first thing this screen has to prove is that non-zero audio
 * is actually moving.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
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

const SERVER_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL;
const TOKEN = process.env.EXPO_PUBLIC_LIVEKIT_TOKEN;

export default function App() {
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string>();

  // The native audio session has to be running before any track is published,
  // on both platforms. Starting it on mount rather than on join keeps the
  // first connection from racing it.
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
    return <SetupNeeded />;
  }

  if (!joined) {
    return (
      <Shell>
        <Text style={styles.eyebrow}>In the room</Text>
        <Text style={styles.title}>Join the call</Text>
        <Text style={styles.body}>
          Opens a real WebRTC call. Bring a second participant in from a browser or another
          phone, then watch both meters move.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.primary} onPress={() => setJoined(true)}>
          <Text style={styles.primaryLabel}>Join</Text>
        </Pressable>
      </Shell>
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
      <CallScreen onLeave={() => setJoined(false)} error={error} />
    </LiveKitRoom>
  );
}

function CallScreen({ onLeave, error }: { onLeave: () => void; error?: string }) {
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();

  // Every microphone in the room, local and remote, as track references.
  const micTracks = useTracks([Track.Source.Microphone]);

  const connecting = connection === ConnectionState.Connecting;

  const toggleMic = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
  }, [localParticipant]);

  return (
    <Shell>
      <View style={styles.statusRow}>
        <View style={[styles.dot, connection === ConnectionState.Connected && styles.dotLive]} />
        <Text style={styles.status}>{connection}</Text>
        {connecting ? <ActivityIndicator size="small" color="#6F8188" /> : null}
      </View>

      <Text style={styles.title}>On a call</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
        {micTracks.length === 0 ? (
          <Text style={styles.body}>
            No microphones published yet. If this persists after connecting, the mic permission
            was denied or the audio session failed to start.
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

      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={toggleMic}>
          <Text style={styles.secondaryLabel}>
            {localParticipant.isMicrophoneEnabled ? "Mute" : "Unmute"}
          </Text>
        </Pressable>
        <Pressable style={[styles.primary, styles.leave]} onPress={onLeave}>
          <Text style={styles.primaryLabel}>Leave</Text>
        </Pressable>
      </View>
    </Shell>
  );
}

/**
 * One row per microphone, with a live level bar.
 *
 * useTrackVolume returns 0–1 sampled from the actual media track, so a bar
 * that never leaves zero means no audio is reaching us — which is the failure
 * this screen exists to make visible.
 */
function MicMeter({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const volume = useTrackVolume(trackRef);
  const isLocal = trackRef.participant.isLocal;
  const percent = Math.min(100, Math.round(volume * 100));

  return (
    <View style={styles.meterRow}>
      <View style={styles.meterHead}>
        <Text style={styles.who}>
          {trackRef.participant.identity}
          {isLocal ? " (you)" : ""}
        </Text>
        <Text style={styles.level}>{percent}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }, isLocal && styles.fillLocal]} />
      </View>
    </View>
  );
}

function SetupNeeded() {
  return (
    <Shell>
      <Text style={styles.eyebrow}>Setup</Text>
      <Text style={styles.title}>No LiveKit credentials</Text>
      <Text style={styles.body}>
        Create a .env next to package.json with EXPO_PUBLIC_LIVEKIT_URL and
        EXPO_PUBLIC_LIVEKIT_TOKEN, then restart the bundler with --clear.
      </Text>
      <Text style={styles.code}>npm run token -- --room demo --identity phone</Text>
      <Text style={styles.body}>
        Expo only injects EXPO_PUBLIC_ vars at bundle time, so a running Metro will not pick up a
        new .env on its own.
      </Text>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.page}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0E1416" },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, gap: 12 },
  eyebrow: {
    color: "#3FC6D1",
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  title: { color: "#E4EDEF", fontSize: 30, fontWeight: "700", letterSpacing: -0.6 },
  body: { color: "#93A6AC", fontSize: 15, lineHeight: 22 },
  code: {
    color: "#E4EDEF",
    fontFamily: "Menlo",
    fontSize: 12,
    backgroundColor: "#1C262A",
    padding: 12,
    borderRadius: 4,
    overflow: "hidden",
  },
  error: { color: "#E88B7D", fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#6F8188" },
  dotLive: { backgroundColor: "#3FC6D1" },
  status: {
    color: "#6F8188",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  list: { flex: 1, marginTop: 8 },
  listInner: { gap: 18, paddingBottom: 12 },
  meterRow: { gap: 8 },
  meterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  who: { color: "#E4EDEF", fontSize: 15, fontWeight: "600" },
  level: { color: "#6F8188", fontFamily: "Menlo", fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: "#1C262A", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: "#3FC6D1" },
  fillLocal: { backgroundColor: "#7EDDE4" },
  actions: { flexDirection: "row", gap: 12 },
  primary: {
    backgroundColor: "#3FC6D1",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 6,
    alignItems: "center",
    flex: 1,
  },
  primaryLabel: { color: "#0E1416", fontSize: 15, fontWeight: "700" },
  leave: { backgroundColor: "#E88B7D" },
  secondary: {
    borderWidth: 1,
    borderColor: "#35464C",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 6,
    alignItems: "center",
    flex: 1,
  },
  secondaryLabel: { color: "#E4EDEF", fontSize: 15, fontWeight: "600" },
});
