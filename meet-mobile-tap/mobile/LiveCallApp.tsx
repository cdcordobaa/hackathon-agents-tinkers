import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  AudioSession,
  LiveKitRoom,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  useTrackVolume,
  type TrackReferenceOrPlaceholder,
} from "@livekit/react-native";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";
import {
  MONITOR_IDENTITY,
  SESSION_TOPIC,
  parseCallSnapshot,
  type CallSnapshot,
  type RiskLevel,
  type RiskProfile,
} from "../shared/session";
import {
  DEFAULT_GATEWAY_URL,
  requestJoinCredentials,
  validateJoinInput,
  type JoinCredentials,
} from "./src/gateway";

type Phase = "lobby" | "call" | "summary";

type CallSummary = {
  durationSeconds: number;
  profile: RiskProfile | null;
  turnCount: number;
};

const COLORS = {
  ink: "#071214",
  background: "#0E181A",
  surface: "#152326",
  surfaceRaised: "#1B2D31",
  line: "#2C4247",
  text: "#F0F6F6",
  muted: "#A7B8BB",
  quiet: "#748A8F",
  teal: "#48D0D8",
  tealSoft: "#17383C",
  danger: "#FF8E80",
  dangerSoft: "#3A2424",
  warning: "#F1C36A",
  warningSoft: "#3B3320",
  success: "#72D6AE",
  successSoft: "#19352E",
};

const RISK_TONE: Record<RiskLevel, { label: string; color: string; surface: string }> = {
  none: { label: "Clear", color: COLORS.success, surface: COLORS.successSoft },
  low: { label: "Low", color: COLORS.teal, surface: COLORS.tealSoft },
  elevated: { label: "Elevated", color: COLORS.warning, surface: COLORS.warningSoft },
  high: { label: "High", color: COLORS.danger, surface: COLORS.dangerSoft },
};

export default function App() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [credentials, setCredentials] = useState<JoinCredentials | null>(null);
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [lobbyError, setLobbyError] = useState<string>();
  const [callError, setCallError] = useState<string>();
  const [joining, setJoining] = useState(false);

  const audioStartedRef = useRef(false);
  const hadConnectedRef = useRef(false);
  const elapsedRef = useRef(0);
  const snapshotRef = useRef<CallSnapshot | null>(null);
  const endingRef = useRef(false);
  const roomErrorRef = useRef<string | undefined>(undefined);

  const updateSnapshot = useCallback((next: CallSnapshot) => {
    if (snapshotRef.current && next.sequence <= snapshotRef.current.sequence) return;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const stopAudio = useCallback(async () => {
    if (!audioStartedRef.current) return;
    audioStartedRef.current = false;
    try {
      await AudioSession.stopAudioSession();
    } catch {
      // The room is already closed. Do not strand the user on the call screen.
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioStartedRef.current) void AudioSession.stopAudioSession();
    };
  }, []);

  const finishCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    const finalSnapshot = snapshotRef.current;
    const connected = hadConnectedRef.current;

    setCredentials(null);
    await stopAudio();

    if (connected) {
      setSummary({
        durationSeconds: elapsedRef.current,
        profile: finalSnapshot?.profile ?? null,
        turnCount: finalSnapshot?.turns.length ?? 0,
      });
      setPhase("summary");
    } else {
      setLobbyError((current) =>
        current ??
        roomErrorRef.current ??
        "The room closed before connecting. Check the gateway and LiveKit settings.",
      );
      setPhase("lobby");
    }
  }, [stopAudio]);

  const join = useCallback(
    async (gatewayUrl: string, roomName: string, displayName: string) => {
      setJoining(true);
      setLobbyError(undefined);
      setCallError(undefined);
      try {
        const nextCredentials = await requestJoinCredentials({ gatewayUrl, roomName, displayName });
        await AudioSession.startAudioSession();
        audioStartedRef.current = true;
        hadConnectedRef.current = false;
        elapsedRef.current = 0;
        snapshotRef.current = null;
        endingRef.current = false;
        roomErrorRef.current = undefined;
        setSnapshot(null);
        setSummary(null);
        setCredentials(nextCredentials);
        setPhase("call");
      } catch (cause) {
        await stopAudio();
        setLobbyError(cause instanceof Error ? cause.message : "Could not start the call. Try again.");
      } finally {
        setJoining(false);
      }
    },
    [stopAudio],
  );

  const handleConnected = useCallback(() => {
    hadConnectedRef.current = true;
  }, []);

  const handleElapsed = useCallback((seconds: number) => {
    elapsedRef.current = seconds;
  }, []);

  const handleRoomError = useCallback((cause: Error) => {
    const message = `LiveKit could not continue the call: ${cause.message}`;
    roomErrorRef.current = message;
    setCallError(message);
  }, []);

  const resetLobby = useCallback(() => {
    setSummary(null);
    setSnapshot(null);
    setLobbyError(undefined);
    setPhase("lobby");
  }, []);

  return (
    <Shell>
      {phase === "lobby" ? (
        <LobbyScreen joining={joining} error={lobbyError} onJoin={join} />
      ) : null}

      {phase === "call" && credentials ? (
        <LiveKitRoom
          key={`${credentials.roomName}:${credentials.identity}`}
          serverUrl={credentials.url}
          token={credentials.token}
          audio={true}
          video={false}
          connect={true}
          onDisconnected={() => void finishCall()}
          onError={handleRoomError}
        >
          <CallScreen
            roomName={credentials.roomName}
            snapshot={snapshot}
            error={callError}
            onSnapshot={updateSnapshot}
            onConnected={handleConnected}
            onElapsed={handleElapsed}
            onLeave={finishCall}
          />
        </LiveKitRoom>
      ) : null}

      {phase === "summary" && summary ? (
        <SummaryScreen summary={summary} onDone={resetLobby} />
      ) : null}
    </Shell>
  );
}

function LobbyScreen({
  joining,
  error,
  onJoin,
}: {
  joining: boolean;
  error?: string;
  onJoin: (gatewayUrl: string, roomName: string, displayName: string) => Promise<void>;
}) {
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [roomName, setRoomName] = useState("demo");
  const [displayName, setDisplayName] = useState("Guest");
  const [consented, setConsented] = useState(false);
  const [validationError, setValidationError] = useState<string>();

  const submit = useCallback(() => {
    const issue = validateJoinInput({ gatewayUrl, roomName, displayName });
    if (issue) {
      setValidationError(issue);
      return;
    }
    if (!consented) {
      setValidationError("Confirm that everyone on the call has agreed to transcription and analysis.");
      return;
    }
    setValidationError(undefined);
    void onJoin(gatewayUrl, roomName, displayName);
  }, [consented, displayName, gatewayUrl, onJoin, roomName]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.lobbyContent}
      keyboardShouldPersistTaps="handled"
    >
      <Brand />
      <View style={styles.intro}>
        <Text style={styles.title}>Join a protected call</Text>
        <Text style={styles.body}>
          SecureGuIA listens with everyone’s permission and flags social-engineering risk while
          the conversation is happening.
        </Text>
      </View>

      <View style={styles.form}>
        <Field
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          autoCapitalize="words"
          editable={!joining}
        />
        <Field
          label="Room"
          value={roomName}
          onChangeText={setRoomName}
          placeholder="demo"
          autoCapitalize="none"
          editable={!joining}
        />
        <Field
          label="Gateway URL"
          value={gatewayUrl}
          onChangeText={setGatewayUrl}
          placeholder="http://localhost:8787"
          autoCapitalize="none"
          keyboardType="url"
          editable={!joining}
          hint="On a physical phone, use your computer’s LAN address."
        />
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consented, disabled: joining }}
        accessibilityLabel="Everyone has agreed to transcription and analysis"
        disabled={joining}
        onPress={() => setConsented((current) => !current)}
        style={({ pressed }) => [styles.consentRow, pressed && styles.pressed]}
      >
        <View style={[styles.checkbox, consented && styles.checkboxChecked]}>
          <Text style={styles.checkmark}>{consented ? "✓" : ""}</Text>
        </View>
        <Text style={styles.consentText}>
          Everyone on this call has agreed to live transcription and risk analysis.
        </Text>
      </Pressable>

      {validationError || error ? <ErrorMessage message={validationError ?? error ?? ""} /> : null}

      <ActionButton label="Join call" loading={joining} disabled={joining} onPress={submit} />
      <Text style={styles.privacyNote}>
        Your microphone is shared only after the secure room connects.
      </Text>
    </ScrollView>
  );
}

function CallScreen({
  roomName,
  snapshot,
  error,
  onSnapshot,
  onConnected,
  onElapsed,
  onLeave,
}: {
  roomName: string;
  snapshot: CallSnapshot | null;
  error?: string;
  onSnapshot: (snapshot: CallSnapshot) => void;
  onConnected: () => void;
  onElapsed: (seconds: number) => void;
  onLeave: () => Promise<void>;
}) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants().filter(
    (participant) => participant.identity !== MONITOR_IDENTITY,
  );
  const micTracks = useTracks([Track.Source.Microphone]);
  const connectedAtRef = useRef<number | undefined>(undefined);
  const lastSnapshotSequenceRef = useRef(-1);
  const [now, setNow] = useState(() => Date.now());
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState<number>();
  const [micBusy, setMicBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    if (connection === ConnectionState.Connected && connectedAtRef.current === undefined) {
      connectedAtRef.current = Date.now();
      onConnected();
    }
  }, [connection, onConnected]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const elapsedSeconds = connectedAtRef.current
    ? Math.max(0, Math.floor((now - connectedAtRef.current) / 1_000))
    : 0;

  useEffect(() => {
    onElapsed(elapsedSeconds);
  }, [elapsedSeconds, onElapsed]);

  useEffect(() => {
    const handleData = (
      payload: Uint8Array,
      participant: RemoteParticipant | undefined,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic !== SESSION_TOPIC || participant?.identity !== MONITOR_IDENTITY) return;
      const next = parseCallSnapshot(new TextDecoder().decode(payload));
      if (!next || next.roomName !== roomName) return;
      const receivedAt = Date.now();
      if (
        next.sequence <= lastSnapshotSequenceRef.current ||
        next.startedAt > receivedAt + 5 * 60_000 ||
        next.updatedAt > receivedAt + 5 * 60_000
      ) return;
      lastSnapshotSequenceRef.current = next.sequence;
      setSnapshotReceivedAt(receivedAt);
      onSnapshot(next);
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [onSnapshot, room, roomName]);

  const state = resolveCallState(
    connection,
    snapshot,
    participants.length,
    connectedAtRef.current !== undefined,
  );
  const isConnected = connection === ConnectionState.Connected;
  const muted = !localParticipant.isMicrophoneEnabled;
  const snapshotAgeSeconds = snapshot && snapshotReceivedAt
    ? Math.max(0, Math.floor((now - snapshotReceivedAt) / 1_000))
    : 0;
  const stale = Boolean(snapshot && snapshotReceivedAt && snapshot.status !== "ended" && snapshotAgeSeconds > 15);

  const toggleMic = useCallback(async () => {
    if (!isConnected || micBusy) return;
    setActionError(undefined);
    setMicBusy(true);
    try {
      await localParticipant.setMicrophoneEnabled(muted);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? `Could not ${muted ? "unmute" : "mute"}: ${cause.message}`
          : `Could not ${muted ? "unmute" : "mute"}. Try again.`,
      );
    } finally {
      setMicBusy(false);
    }
  }, [isConnected, localParticipant, micBusy, muted]);

  const leave = useCallback(async () => {
    if (leaving) return;
    setActionError(undefined);
    setLeaving(true);
    try {
      await room.disconnect();
      await onLeave();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? `Could not leave cleanly: ${cause.message}`
          : "Could not leave the call.",
      );
      setLeaving(false);
    }
  }, [leaving, onLeave, room]);

  return (
    <View style={styles.callScreen}>
      <View style={styles.callHeader}>
        <Brand compact />
        {isConnected ? <Text style={styles.timer}>{formatDuration(elapsedSeconds)}</Text> : null}
      </View>

      <View accessibilityLiveRegion="polite" style={styles.liveState}>
        <View style={[styles.liveDot, { backgroundColor: state.color }]} />
        <View style={styles.liveCopy}>
          <Text style={styles.liveTitle}>{state.title}</Text>
          <Text style={styles.liveDetail}>{state.detail}</Text>
        </View>
      </View>

      <ScrollView style={styles.callScroll} contentContainerStyle={styles.callContent}>
        {error || actionError ? <ErrorMessage message={actionError ?? error ?? ""} /> : null}

        <RiskHud snapshot={snapshot} stale={stale} ageSeconds={snapshotAgeSeconds} />

        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>People in the call</Text>
            <Text style={styles.sectionCount}>{participants.length}</Text>
          </View>
          <View style={styles.peopleList}>
            {participants.map((participant) => {
              const trackRef = micTracks.find(
                (track) => track.participant.identity === participant.identity,
              );
              return (
                <ParticipantMeter
                  key={participant.identity}
                  name={participant.name || participant.identity}
                  isLocal={participant.isLocal}
                  muted={participant.isMicrophoneEnabled === false}
                  trackRef={trackRef}
                />
              );
            })}
          </View>
        </View>

        <Transcript snapshot={snapshot} />
      </ScrollView>

      <View style={styles.callFooter}>
        <ControlButton
          label={muted ? "Unmute" : "Mute"}
          accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"}
          icon={muted ? "+" : "—"}
          loading={micBusy}
          disabled={!isConnected || leaving}
          onPress={() => void toggleMic()}
        />
        <ControlButton
          label="Leave"
          accessibilityLabel="Leave call"
          icon="×"
          danger
          loading={leaving}
          disabled={leaving}
          onPress={() => void leave()}
        />
      </View>
    </View>
  );
}

function RiskHud({
  snapshot,
  stale,
  ageSeconds,
}: {
  snapshot: CallSnapshot | null;
  stale: boolean;
  ageSeconds: number;
}) {
  const profile = snapshot?.profile ?? null;

  if (snapshot?.status === "degraded") {
    const lastTone = profile ? RISK_TONE[profile.risk] : null;
    return (
      <View style={[styles.riskPanel, styles.riskUnavailable]} accessibilityLiveRegion="polite">
        <Text style={[styles.riskBand, { color: COLORS.warning }]}>Analysis unavailable</Text>
        <Text style={styles.riskWaitingTitle}>Current guidance is paused</Text>
        <Text style={styles.riskWaitingDetail}>
          {snapshot.detail || "SecureGuIA is not receiving enough information to assess this call."}
        </Text>
        {profile && lastTone ? (
          <Text style={styles.historicalAssessment}>
            Last completed assessment: {lastTone.label.toLowerCase()} risk · {profile.score}/100.
            This may no longer reflect the conversation.
          </Text>
        ) : null}
        <Text style={[styles.recency, styles.recencyStale]}>
          {ageSeconds > 0 ? `Last monitor update received ${ageSeconds}s ago` : "Waiting for the monitor to recover"}
        </Text>
      </View>
    );
  }

  if (snapshot?.status === "ended") {
    const finalTone = profile ? RISK_TONE[profile.risk] : null;
    return (
      <View style={styles.riskPanel} accessibilityLiveRegion="polite">
        <Text style={[styles.riskBand, { color: COLORS.quiet }]}>Monitoring ended</Text>
        <Text style={styles.riskWaitingTitle}>Live analysis has stopped</Text>
        <Text style={styles.riskWaitingDetail}>
          {snapshot.detail || "The monitor is no longer assessing this conversation."}
        </Text>
        {profile && finalTone ? (
          <Text style={styles.historicalAssessment}>
            Final recorded assessment: {finalTone.label.toLowerCase()} risk · {profile.score}/100.
          </Text>
        ) : null}
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.riskPanel} accessibilityLiveRegion="polite">
        <View style={styles.riskWaitingRow}>
          <ActivityIndicator size="small" color={COLORS.teal} />
          <View style={styles.riskWaitingCopy}>
            <Text style={styles.riskWaitingTitle}>Waiting for analysis</Text>
            <Text style={styles.riskWaitingDetail}>
              {snapshot?.detail || "SecureGuIA is waiting for enough conversation to assess."}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const tone = RISK_TONE[profile.risk];
  return (
    <View
      style={[styles.riskPanel, { backgroundColor: tone.surface }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.riskTopRow}>
        <View style={styles.riskCopy}>
          <Text style={[styles.riskBand, { color: tone.color }]}>{tone.label} risk</Text>
          <Text style={styles.riskHeadline}>{profile.headline}</Text>
        </View>
        <View style={styles.scoreWrap}>
          <Text style={[styles.score, { color: tone.color }]}>{profile.score}</Text>
          <Text style={styles.scoreOutOf}>/100</Text>
        </View>
      </View>

      {profile.advice ? (
        <View style={styles.adviceBox}>
          <Text style={styles.adviceLabel}>Do this now</Text>
          <Text style={styles.advice}>{profile.advice}</Text>
        </View>
      ) : null}

      {profile.signals.length > 0 ? (
        <View style={styles.signalList}>
          <Text style={styles.signalHeading}>Signals detected</Text>
          {profile.signals.slice(0, 4).map((signal, index) => (
            <View key={`${signal.type}:${index}`} style={styles.signalRow}>
              <View style={[styles.signalMark, { backgroundColor: tone.color }]} />
              <View style={styles.signalCopy}>
                <Text style={styles.signalType}>{humanize(signal.type)}</Text>
                <Text style={styles.signalQuote}>“{signal.quote}”</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[styles.recency, stale && styles.recencyStale]}>
        {stale ? `Analysis may be delayed · last update ${ageSeconds}s ago` : "Analysis is live"}
      </Text>
    </View>
  );
}

function ParticipantMeter({
  name,
  isLocal,
  muted,
  trackRef,
}: {
  name: string;
  isLocal: boolean;
  muted: boolean;
  trackRef?: TrackReferenceOrPlaceholder;
}) {
  return (
    <View style={styles.personRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(name)}</Text>
      </View>
      <View style={styles.personContent}>
        <View style={styles.personHeading}>
          <Text numberOfLines={1} style={styles.personName}>
            {name}{isLocal ? " · you" : ""}
          </Text>
          <Text style={styles.micState}>{muted ? "Muted" : trackRef ? "Mic live" : "No audio"}</Text>
        </View>
        {trackRef ? <LiveMeter trackRef={trackRef} /> : <View style={styles.meterTrack} />}
      </View>
    </View>
  );
}

function LiveMeter({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const volume = useTrackVolume(trackRef);
  const visiblePercent = Math.min(100, Math.max(0, Math.round(volume * 100)));
  return (
    <View
      accessible
      accessibilityLabel={`${trackRef.participant.identity} audio level ${Math.round(volume * 100)} percent`}
      style={styles.meterTrack}
    >
      <View style={[styles.meterFill, { width: `${visiblePercent}%` }]} />
    </View>
  );
}

function Transcript({ snapshot }: { snapshot: CallSnapshot | null }) {
  const turns = snapshot?.turns.slice(-16) ?? [];
  const totalTurns = snapshot?.turns.length ?? 0;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionTitle}>Live transcript</Text>
        {totalTurns > 0 ? <Text style={styles.sectionCount}>{totalTurns}</Text> : null}
      </View>
      {turns.length === 0 ? (
        <View style={styles.emptyTranscript}>
          <Text style={styles.emptyTitle}>Listening for speech</Text>
          <Text style={styles.emptyBody}>Speaker-labelled transcript will appear here.</Text>
        </View>
      ) : (
        <View style={styles.turnList}>
          {turns.map((turn) => (
            <View key={turn.id} style={styles.turn}>
              <View style={styles.turnMeta}>
                <Text numberOfLines={1} style={styles.turnSpeaker}>{turn.speakerName}</Text>
                <Text style={styles.turnTime}>{formatDuration(Math.floor(turn.at / 1_000))}</Text>
              </View>
              <Text style={styles.turnText}>{turn.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SummaryScreen({ summary, onDone }: { summary: CallSummary; onDone: () => void }) {
  const tone = summary.profile ? RISK_TONE[summary.profile.risk] : null;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.summaryContent}>
      <Brand />
      <View style={styles.summaryMark}>
        <Text style={styles.summaryMarkText}>✓</Text>
      </View>
      <View style={styles.intro}>
        <Text style={styles.title}>Call ended</Text>
        <Text style={styles.body}>Your microphone and audio session have been closed.</Text>
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.summaryStat}>
          <Text style={styles.summaryValue}>{formatDuration(summary.durationSeconds)}</Text>
          <Text style={styles.summaryLabel}>Duration</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryStat}>
          <Text style={styles.summaryValue}>{summary.turnCount}</Text>
          <Text style={styles.summaryLabel}>Transcript turns</Text>
        </View>
      </View>

      {summary.profile && tone ? (
        <View style={[styles.finalAssessment, { backgroundColor: tone.surface }]}>
          <View style={styles.finalAssessmentTop}>
            <Text style={[styles.riskBand, { color: tone.color }]}>{tone.label} risk</Text>
            <Text style={[styles.finalScore, { color: tone.color }]}>{summary.profile.score}/100</Text>
          </View>
          <Text style={styles.riskHeadline}>{summary.profile.headline}</Text>
          {summary.profile.advice ? <Text style={styles.finalAdvice}>{summary.profile.advice}</Text> : null}
        </View>
      ) : (
        <View style={styles.finalAssessment}>
          <Text style={styles.riskWaitingTitle}>No assessment received</Text>
          <Text style={styles.riskWaitingDetail}>The call ended before SecureGuIA returned an analysis.</Text>
        </View>
      )}

      <ActionButton label="Join another call" onPress={onDone} />
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  const inputId = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <View style={styles.field}>
      <Text nativeID={`${inputId}-label`} style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabelledBy={`${inputId}-label`}
        placeholderTextColor={COLORS.quiet}
        selectionColor={COLORS.teal}
        style={styles.input}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function ActionButton({
  label,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.primaryPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      {loading ? <ActivityIndicator color={COLORS.ink} /> : <Text style={styles.primaryLabel}>{label}</Text>}
    </Pressable>
  );
}

function ControlButton({
  label,
  icon,
  danger = false,
  loading = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        danger && styles.controlDanger,
        pressed && styles.pressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={danger ? COLORS.danger : COLORS.text} />
      ) : (
        <Text style={[styles.controlIcon, danger && styles.controlIconDanger]}>{icon}</Text>
      )}
      <Text style={[styles.controlLabel, danger && styles.controlLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.errorBox}>
      <Text style={styles.errorTitle}>Something needs attention</Text>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brand}>
      <View style={[styles.brandMark, compact && styles.brandMarkCompact]}>
        <View style={styles.brandMarkCore} />
      </View>
      <Text style={[styles.brandName, compact && styles.brandNameCompact]}>SecureGuIA</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {children}
    </SafeAreaView>
  );
}

function resolveCallState(
  connection: ConnectionState,
  snapshot: CallSnapshot | null,
  participantCount: number,
  hasConnected: boolean,
): { title: string; detail: string; color: string } {
  if (snapshot?.status === "ended") {
    return {
      title: "Call ended",
      detail: snapshot.detail || "The monitored session has ended.",
      color: COLORS.quiet,
    };
  }
  if (
    connection === ConnectionState.Reconnecting ||
    connection === ConnectionState.SignalReconnecting
  ) {
    return {
      title: "Reconnecting",
      detail: "Audio may pause while the secure link recovers.",
      color: COLORS.warning,
    };
  }
  if (connection === ConnectionState.Connecting || !hasConnected) {
    return {
      title: "Connecting securely",
      detail: "Opening the room and microphone…",
      color: COLORS.warning,
    };
  }
  if (connection === ConnectionState.Connected && participantCount <= 1) {
    return {
      title: "Waiting for another caller",
      detail: "Share this room name with the other participant.",
      color: COLORS.warning,
    };
  }
  if (connection === ConnectionState.Connected) {
    return {
      title: "Call in progress",
      detail: `${participantCount} people connected · audio link is live`,
      color: COLORS.teal,
    };
  }
  return {
    title: "Call ended",
    detail: "The room connection has closed.",
    color: COLORS.quiet,
  };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1 },
  lobbyContent: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 36, gap: 24 },
  summaryContent: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 36, gap: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkCompact: { width: 26, height: 26, borderRadius: 8 },
  brandMarkCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.teal },
  brandName: { color: COLORS.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  brandNameCompact: { fontSize: 16 },
  intro: { gap: 9 },
  title: { color: COLORS.text, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.7 },
  body: { color: COLORS.muted, fontSize: 16, lineHeight: 24 },
  form: { gap: 18 },
  field: { gap: 7 },
  fieldLabel: { color: COLORS.text, fontSize: 14, fontWeight: "600" },
  fieldHint: { color: COLORS.quiet, fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    fontSize: 16,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  consentRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.quiet,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { borderColor: COLORS.teal, backgroundColor: COLORS.teal },
  checkmark: { color: COLORS.ink, fontSize: 15, lineHeight: 18, fontWeight: "800" },
  consentText: { flex: 1, color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  privacyNote: { color: COLORS.quiet, textAlign: "center", fontSize: 12, lineHeight: 17 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryPressed: { backgroundColor: "#78E1E6" },
  primaryLabel: { color: COLORS.ink, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.76 },
  buttonDisabled: { opacity: 0.45 },
  errorBox: { gap: 4, borderRadius: 12, backgroundColor: COLORS.dangerSoft, padding: 14 },
  errorTitle: { color: COLORS.danger, fontSize: 13, fontWeight: "700" },
  errorText: { color: "#FFD4CF", fontSize: 13, lineHeight: 19 },
  callScreen: { flex: 1 },
  callHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timer: { color: COLORS.text, fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  liveState: {
    marginHorizontal: 20,
    marginBottom: 8,
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  liveCopy: { flex: 1, gap: 2 },
  liveTitle: { color: COLORS.text, fontSize: 19, lineHeight: 24, fontWeight: "700", letterSpacing: -0.25 },
  liveDetail: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  callScroll: { flex: 1 },
  callContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 24 },
  riskPanel: { borderRadius: 15, backgroundColor: COLORS.surface, padding: 17, gap: 16 },
  riskUnavailable: { backgroundColor: COLORS.warningSoft },
  riskWaitingRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 14 },
  riskWaitingCopy: { flex: 1, gap: 3 },
  riskWaitingTitle: { color: COLORS.text, fontSize: 16, fontWeight: "700" },
  riskWaitingDetail: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  historicalAssessment: { color: COLORS.text, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  riskTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  riskCopy: { flex: 1 },
  riskBand: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7 },
  riskHeadline: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.3 },
  scoreWrap: { flexDirection: "row", alignItems: "baseline" },
  score: { fontSize: 34, lineHeight: 38, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  scoreOutOf: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  adviceBox: { backgroundColor: "rgba(7,18,20,0.34)", borderRadius: 12, padding: 13, gap: 4 },
  adviceLabel: { color: COLORS.teal, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  advice: { color: COLORS.text, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  signalList: { gap: 11 },
  signalHeading: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  signalRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  signalMark: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  signalCopy: { flex: 1, gap: 2 },
  signalType: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  signalQuote: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  recency: { color: COLORS.success, fontSize: 11, fontWeight: "600" },
  recencyStale: { color: COLORS.warning },
  section: { gap: 12 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: "700" },
  sectionCount: {
    minWidth: 24,
    color: COLORS.muted,
    fontSize: 12,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  peopleList: { gap: 10 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: COLORS.teal, fontSize: 13, fontWeight: "800" },
  personContent: { flex: 1, gap: 8 },
  personHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  personName: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "600" },
  micState: { color: COLORS.quiet, fontSize: 11 },
  meterTrack: { height: 5, borderRadius: 3, backgroundColor: COLORS.surfaceRaised, overflow: "hidden" },
  meterFill: { height: 5, borderRadius: 3, backgroundColor: COLORS.teal },
  emptyTranscript: { borderRadius: 12, backgroundColor: COLORS.surface, padding: 16, gap: 4 },
  emptyTitle: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  turnList: { gap: 16 },
  turn: { gap: 5 },
  turnMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  turnSpeaker: { flex: 1, color: COLORS.teal, fontSize: 12, fontWeight: "700" },
  turnTime: { color: COLORS.quiet, fontSize: 11, fontVariant: ["tabular-nums"] },
  turnText: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  callFooter: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.background,
  },
  control: {
    width: 76,
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
  },
  controlDanger: { backgroundColor: COLORS.dangerSoft },
  controlIcon: { color: COLORS.text, fontSize: 24, lineHeight: 25, fontWeight: "500" },
  controlIconDanger: { color: COLORS.danger },
  controlLabel: { color: COLORS.text, fontSize: 12, fontWeight: "600" },
  controlLabelDanger: { color: COLORS.danger },
  summaryMark: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: COLORS.successSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  summaryMarkText: { color: COLORS.success, fontSize: 28, fontWeight: "800" },
  summaryStats: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    paddingVertical: 18,
  },
  summaryStat: { flex: 1, alignItems: "center", gap: 5 },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  summaryValue: { color: COLORS.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summaryLabel: { color: COLORS.muted, fontSize: 11 },
  finalAssessment: { borderRadius: 15, backgroundColor: COLORS.surface, padding: 17, gap: 8 },
  finalAssessmentTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  finalScore: { fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  finalAdvice: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: 2 },
});
