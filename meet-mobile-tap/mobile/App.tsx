/**
 * setup -> consent -> call -> summary.
 *
 * The gateway socket only opens once the user leaves setup (start() is
 * called from the consent screen's mount, see below) and consent is what
 * actually starts the session on the wire — session.start fires on first
 * connect, but the session itself stays in `awaiting-consent` server-side
 * until consent.granted arrives (add-call-session-contracts). No path from
 * `screen` back to `"call"` skips the consent screen: `call` is only ever
 * reached by ConsentScreen's onGrant.
 *
 * CopilotKitProvider wraps everything so the assistant's registered tools
 * and agent state are ready the moment CallScreen mounts, and it costs
 * nothing while unused on the other screens.
 */
import { useCallback, useMemo, useState } from "react";
import { SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import type { TranscriptSourceKind } from "../shared/src";
import { RUNTIME_URL } from "./src/config";
import { createSessionId } from "./src/gateway/session-id";
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
  const [sessionId, setSessionId] = useState(() => createSessionId());

  const gateway = useGatewaySession(sessionId);
  const [consentError, setConsentError] = useState<string>();
  const [granting, setGranting] = useState(false);

  const startAttempt = useCallback(() => {
    gateway.start(transport);
    setScreen("consent");
  }, [gateway, transport]);

  const grantConsent = useCallback(() => {
    setGranting(true);
    setConsentError(undefined);
    gateway.grantConsent();
    setScreen("call");
    setGranting(false);
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
    setSessionId(createSessionId());
    setConsentError(undefined);
    setScreen("setup");
  }, []);

  // Surface a session-level error (e.g. the gateway rejecting session.start)
  // on the consent screen, the only place it can still change the outcome.
  const errorForConsent = useMemo(
    () => (screen === "consent" ? gateway.state.lastError ?? consentError : undefined),
    [screen, gateway.state.lastError, consentError],
  );

  return (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {screen === "setup" ? (
          <SetupScreen selected={transport} onSelect={setTransport} onContinue={startAttempt} />
        ) : null}

        {screen === "consent" ? (
          <ConsentScreen granting={granting} error={errorForConsent} onGrant={grantConsent} onDecline={declineConsent} />
        ) : null}

        {screen === "call" ? <CallScreen transport={transport} state={gateway.state} onEndCall={endCall} /> : null}

        {screen === "summary" ? <SummaryScreen state={gateway.state} onStartNew={startNew} /> : null}
      </SafeAreaView>
    </CopilotKitProvider>
  );
}
