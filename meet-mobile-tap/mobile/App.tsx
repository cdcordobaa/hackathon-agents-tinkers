/**
 * setup -> consent -> call -> summary.
 *
 * Leaving setup creates the session (`POST /session`, then its WebSocket —
 * see gateway/client.ts) and moves to consent; ConsentScreen's buttons stay
 * disabled until that connection is confirmed open, so `grantConsent`/
 * `declineConsent` are never sent into a socket that isn't there yet to
 * silently drop them. No path from `screen` back to `"call"` skips the
 * consent screen: `call` is only ever reached by ConsentScreen's onGrant.
 *
 * CopilotKitProvider wraps everything so the assistant's registered tools
 * and agent state are ready the moment CallScreen mounts, and it costs
 * nothing while unused on the other screens.
 */
import { useCallback, useState } from "react";
import { SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import type { TranscriptSourceKind } from "../shared/src";
import { RUNTIME_URL } from "./src/config";
import { useGatewaySession } from "./src/gateway/useGatewaySession";
import { SetupScreen } from "./src/screens/SetupScreen";
import { ConsentScreen } from "./src/screens/ConsentScreen";
import { CallScreen } from "./src/screens/CallScreen";
import { SummaryScreen } from "./src/screens/SummaryScreen";
import { styles } from "./src/styles";

type Screen = "setup" | "consent" | "call" | "summary";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [transport, setTransport] = useState<TranscriptSourceKind>("replay");
  // Bumped to force a brand-new GatewaySessionClient — and so a fresh
  // POST /session — each time the user starts over from setup.
  const [attempt, setAttempt] = useState(0);

  const gateway = useGatewaySession(attempt);

  const startAttempt = useCallback(() => {
    void gateway.start(transport);
    setScreen("consent");
  }, [gateway, transport]);

  const grantConsent = useCallback(() => {
    gateway.grantConsent();
    setScreen("call");
  }, [gateway]);

  const declineConsent = useCallback(() => {
    gateway.declineConsent();
    setScreen("setup");
  }, [gateway]);

  const endCall = useCallback(() => {
    gateway.endSession();
    gateway.disconnect();
    setScreen("summary");
  }, [gateway]);

  const startNew = useCallback(() => {
    setAttempt((n) => n + 1);
    setScreen("setup");
  }, []);

  // The consent screen's buttons are gated on this: sending consent.granted
  // or consent.declined into a socket that is not open yet would be silently
  // dropped by GatewaySessionClient.send (see client.ts).
  const gatewayReady = gateway.state.connection === "open";

  return (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {screen === "setup" ? (
          <SetupScreen selected={transport} onSelect={setTransport} onContinue={startAttempt} />
        ) : null}

        {screen === "consent" ? (
          <ConsentScreen
            ready={gatewayReady}
            error={gateway.state.lastError}
            onGrant={grantConsent}
            onDecline={declineConsent}
          />
        ) : null}

        {screen === "call" ? <CallScreen transport={transport} state={gateway.state} onEndCall={endCall} /> : null}

        {screen === "summary" ? <SummaryScreen state={gateway.state} onStartNew={startNew} /> : null}
      </SafeAreaView>
    </CopilotKitProvider>
  );
}
