import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { AudioSession, LiveKitRoom } from "@livekit/react-native";
import { COPILOTKIT_RUNTIME_URL, GATEWAY_URL } from "./src/config";
import { requestJoinCredentials, validateJoinInput, type JoinCredentials } from "./src/gateway";
import { initialGatewayState, type GatewayState } from "./src/gateway/reducer";
import { useGatewaySession } from "./src/gateway/useGatewaySession";
import { LiveKitSession } from "./src/livekit/LiveKitSession";
import { SetupScreen, type CallRole, type MobileTransport } from "./src/screens/SetupScreen";
import { ConsentScreen } from "./src/screens/ConsentScreen";
import { CallScreen } from "./src/screens/CallScreen";
import { SummaryScreen } from "./src/screens/SummaryScreen";
import { styles } from "./src/styles";

type Screen = "setup" | "consent" | "call" | "summary";

export default function SessionApp() {
  const content = <SessionFlow assistantEnabled={Boolean(COPILOTKIT_RUNTIME_URL)} />;
  return COPILOTKIT_RUNTIME_URL ? (
    <CopilotKitProvider runtimeUrl={COPILOTKIT_RUNTIME_URL}>{content}</CopilotKitProvider>
  ) : content;
}

function SessionFlow({ assistantEnabled }: { assistantEnabled: boolean }) {
  const [screen, setScreen] = useState<Screen>("setup");
  const [transport, setTransport] = useState<MobileTransport>("livekit");
  const [gatewayUrl, setGatewayUrl] = useState(GATEWAY_URL);
  const [roomName, setRoomName] = useState("demo");
  const [displayName, setDisplayName] = useState("Guest");
  const [role, setRole] = useState<CallRole>("subject");
  const [attempt, setAttempt] = useState(0);
  const [credentials, setCredentials] = useState<JoinCredentials | null>(null);
  const [summaryState, setSummaryState] = useState<GatewayState>(initialGatewayState);
  const [setupError, setSetupError] = useState<string>();
  const [consentError, setConsentError] = useState<string>();
  const [liveCallError, setLiveCallError] = useState<string>();
  const [joining, setJoining] = useState(false);
  const [endingReplay, setEndingReplay] = useState(false);

  const gateway = useGatewaySession(attempt, gatewayUrl);
  const joinAbortRef = useRef<AbortController | undefined>(undefined);
  const joinGenerationRef = useRef(0);
  const audioStartedRef = useRef(false);
  const endingLiveRef = useRef(false);
  const liveConnectedRef = useRef(false);
  const liveStateRef = useRef<GatewayState>(initialGatewayState());
  const liveErrorRef = useRef<string | undefined>(undefined);

  const stopAudio = useCallback(async () => {
    if (!audioStartedRef.current) return;
    audioStartedRef.current = false;
    try { await AudioSession.stopAudioSession(); } catch { /* Room teardown still completes. */ }
  }, []);

  useEffect(() => () => {
    joinAbortRef.current?.abort();
    if (audioStartedRef.current) void AudioSession.stopAudioSession();
  }, []);

  const continueToConsent = useCallback(() => {
    setSetupError(undefined);
    setConsentError(undefined);
    if (!/^https?:\/\/[^\s]+$/i.test(gatewayUrl.trim())) {
      setSetupError("Enter a gateway URL beginning with http:// or https://.");
      return;
    }
    if (transport === "livekit") {
      const issue = validateJoinInput({ gatewayUrl, roomName, displayName, role });
      if (issue) {
        setSetupError(issue);
        return;
      }
      setScreen("consent");
      return;
    }
    void gateway.start("replay");
    setScreen("consent");
  }, [displayName, gateway, gatewayUrl, role, roomName, transport]);

  const grantConsent = useCallback(async () => {
    setConsentError(undefined);
    if (transport === "replay") {
      gateway.grantConsent();
      setScreen("call");
      return;
    }

    const generation = ++joinGenerationRef.current;
    const controller = new AbortController();
    joinAbortRef.current?.abort();
    joinAbortRef.current = controller;
    setJoining(true);
    try {
      const next = await requestJoinCredentials({
        gatewayUrl,
        roomName,
        displayName,
        role,
        signal: controller.signal,
      });
      if (generation !== joinGenerationRef.current) return;
      await AudioSession.startAudioSession();
      audioStartedRef.current = true;
      if (generation !== joinGenerationRef.current) {
        await stopAudio();
        return;
      }
      liveConnectedRef.current = false;
      endingLiveRef.current = false;
      liveStateRef.current = initialGatewayState();
      liveErrorRef.current = undefined;
      setLiveCallError(undefined);
      setCredentials(next);
      setScreen("call");
    } catch (cause) {
      if (generation === joinGenerationRef.current && !controller.signal.aborted) {
        setConsentError(cause instanceof Error ? cause.message : "Could not join the LiveKit room.");
      }
      await stopAudio();
    } finally {
      if (generation === joinGenerationRef.current) setJoining(false);
    }
  }, [displayName, gateway, gatewayUrl, role, roomName, stopAudio, transport]);

  const declineConsent = useCallback(() => {
    joinGenerationRef.current += 1;
    joinAbortRef.current?.abort();
    joinAbortRef.current = undefined;
    setJoining(false);
    if (transport === "replay") gateway.declineConsent();
    setAttempt((current) => current + 1);
    setConsentError(undefined);
    void stopAudio();
    setScreen("setup");
  }, [gateway, stopAudio, transport]);

  const endReplay = useCallback(async () => {
    if (endingReplay) return;
    setEndingReplay(true);
    await gateway.endSessionAndWait(2_000);
    const finalState = gateway.getState();
    gateway.disconnect();
    setSummaryState({ ...finalState, connection: "closed", profile: undefined });
    setScreen("summary");
    setEndingReplay(false);
  }, [endingReplay, gateway]);

  const finishLive = useCallback(async (state?: GatewayState) => {
    if (endingLiveRef.current) return;
    endingLiveRef.current = true;
    const finalState = state ?? liveStateRef.current;
    const connected = liveConnectedRef.current;
    setCredentials(null);
    setLiveCallError(undefined);
    if (!connected) {
      setConsentError(liveErrorRef.current ?? "The room closed before connecting. Check LiveKit and try again.");
      setScreen("consent");
      endingLiveRef.current = false;
      await stopAudio();
      return;
    }
    setSummaryState({ ...finalState, connection: "closed", sessionState: "ended", profile: undefined });
    setScreen("summary");
    await stopAudio();
  }, [stopAudio]);

  const startNew = useCallback(() => {
    joinGenerationRef.current += 1;
    joinAbortRef.current?.abort();
    setAttempt((current) => current + 1);
    setCredentials(null);
    setSummaryState(initialGatewayState());
    setSetupError(undefined);
    setConsentError(undefined);
    setScreen("setup");
  }, []);

  const updateLiveState = useCallback((state: GatewayState) => {
    liveStateRef.current = state;
  }, []);

  const markLiveConnected = useCallback(() => {
    liveConnectedRef.current = true;
  }, []);

  const liveError = useCallback((cause: Error) => {
    const message = `LiveKit could not continue the call: ${cause.message}`;
    liveErrorRef.current = message;
    setLiveCallError(message);
  }, []);

  let body: ReactNode;
  if (screen === "setup") {
    body = (
      <SetupScreen
        selected={transport}
        gatewayUrl={gatewayUrl}
        roomName={roomName}
        displayName={displayName}
        role={role}
        error={setupError}
        onSelect={setTransport}
        onGatewayUrl={setGatewayUrl}
        onRoomName={setRoomName}
        onDisplayName={setDisplayName}
        onRole={setRole}
        onContinue={continueToConsent}
      />
    );
  } else if (screen === "consent") {
    body = (
      <ConsentScreen
        transport={transport}
        ready={transport === "livekit" || gateway.state.connection === "open"}
        busy={joining}
        error={consentError ?? gateway.state.lastError}
        onGrant={() => void grantConsent()}
        onDecline={declineConsent}
      />
    );
  } else if (screen === "call" && transport === "livekit" && credentials) {
    body = (
      <LiveKitRoom
        serverUrl={credentials.url}
        token={credentials.token}
        audio={true}
        video={false}
        connect={true}
        onDisconnected={() => void finishLive()}
        onError={liveError}
      >
        <LiveKitSession
          roomName={credentials.roomName}
          role={role}
          assistantEnabled={assistantEnabled}
          error={liveCallError}
          onConnected={markLiveConnected}
          onState={updateLiveState}
          onEnd={finishLive}
        />
      </LiveKitRoom>
    );
  } else if (screen === "call") {
    body = (
      <CallScreen
        transport="replay"
        state={gateway.state}
        assistantEnabled={assistantEnabled}
        ending={endingReplay}
        onEndCall={() => void endReplay()}
      />
    );
  } else {
    body = <SummaryScreen state={summaryState} onStartNew={startNew} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}
