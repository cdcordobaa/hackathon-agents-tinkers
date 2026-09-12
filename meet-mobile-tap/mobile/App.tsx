/**
 * setup -> consent -> call -> summary, for a session THIS phone creates.
 *
 * There is a second path now: setup -> (join) -> call, for a session the
 * BROWSER already created (see web/src/main.ts) and already moved past
 * "awaiting-consent" itself. `origin` tracks which path is live so this file
 * can be honest about it rather than silently reusing the "created it"
 * screen flow for a session it did not create:
 *
 *   - `origin === "created"`: unchanged from before. Leaving setup creates
 *     the session (`POST /session`, then its WebSocket — gateway/client.ts's
 *     `start()`) and moves to consent; ConsentScreen's buttons stay disabled
 *     until that connection is confirmed open, so `grantConsent`/
 *     `declineConsent` are never sent into a socket that isn't there yet to
 *     silently drop them.
 *   - `origin === "joined"`: leaving setup calls `gateway.join(id)` instead
 *     (client.ts's `join()` — no POST, no `session.start`) and moves to
 *     `"consent"` as a WAITING screen, not necessarily a consent PROMPT: the
 *     `routeJoinedSession` effect below watches the replayed session state
 *     and only leaves the consent prompt visible if it is genuinely
 *     "awaiting-consent". If the browser already granted consent, this
 *     effect jumps straight to `"call"` — `joinedAlreadyConsented` records
 *     that so CallScreen can say so, never silently. If the session already
 *     ended before this phone got here, it jumps to `"summary"` instead of
 *     showing a call screen for a call that is over.
 *
 * Either way, no path from `screen` to `"call"` ever skips the consent gate
 * unobserved: `"call"` is reached only by ConsentScreen's onGrant (consent
 * happened HERE) or by `routeJoinedSession` after confirming the session's
 * own state already says "running"/"ending" (consent happened ELSEWHERE,
 * and the UI says so).
 *
 * CopilotKitProvider wraps everything so the assistant's registered tools
 * and agent state are ready the moment CallScreen mounts, and it costs
 * nothing while unused on the other screens.
 */
import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import type { TranscriptSourceKind } from "../shared/src";
import { RUNTIME_URL } from "./src/config";
import { useGatewaySession } from "./src/gateway/useGatewaySession";
import { hasPassedConsent } from "./src/gateway/reducer";
import { loadLastJoinedSessionId, saveLastJoinedSessionId } from "./src/gateway/persisted-session-id";
import { SetupScreen } from "./src/screens/SetupScreen";
import { ConsentScreen } from "./src/screens/ConsentScreen";
import { CallScreen } from "./src/screens/CallScreen";
import { SummaryScreen } from "./src/screens/SummaryScreen";
import { styles } from "./src/styles";

type Screen = "setup" | "consent" | "call" | "summary";
type Origin = "created" | "joined";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [origin, setOrigin] = useState<Origin>("created");
  const [transport, setTransport] = useState<TranscriptSourceKind>("replay");
  const [joinSessionId, setJoinSessionId] = useState(() => loadLastJoinedSessionId());
  // True only when THIS phone skipped the consent prompt because the joined
  // session already said "running"/"ending" — never true for a session this
  // phone itself granted consent on. CallScreen uses it to say so.
  const [joinedAlreadyConsented, setJoinedAlreadyConsented] = useState(false);
  // Bumped to force a brand-new GatewaySessionClient — and so a fresh
  // POST /session or join — each time the user starts over from setup.
  const [attempt, setAttempt] = useState(0);

  const gateway = useGatewaySession(attempt);

  const startAttempt = useCallback(() => {
    setOrigin("created");
    setJoinedAlreadyConsented(false);
    void gateway.start(transport);
    setScreen("consent");
  }, [gateway, transport]);

  const startJoinAttempt = useCallback(() => {
    const id = joinSessionId.trim();
    if (!id) return;
    setOrigin("joined");
    setJoinedAlreadyConsented(false);
    saveLastJoinedSessionId(id);
    gateway.join(id);
    // A waiting screen first, not necessarily a consent PROMPT — see the
    // file header and routeJoinedSession below, which decides where this
    // actually goes once the session's real state has replayed.
    setScreen("consent");
  }, [gateway, joinSessionId]);

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

  const sessionState = gateway.state.sessionState;

  // Only for a JOINED session: the consent screen is showing as a waiting
  // screen (see startJoinAttempt), and this decides what it should actually
  // become once the gateway's replayed backlog says where the session
  // really is. Never fires for `origin === "created"` — that path's session
  // starts at "idle" under this phone's own control and genuinely needs the
  // consent prompt every time.
  useEffect(() => {
    if (origin !== "joined" || screen !== "consent") return;
    if (hasPassedConsent(sessionState)) {
      // The browser (or whoever created it) already granted consent. Never
      // silently behave as if this phone had — record that plainly instead.
      setJoinedAlreadyConsented(true);
      setScreen("call");
    } else if (sessionState === "ended") {
      setScreen("summary");
    }
    // "awaiting-consent" (or still "idle", before the first replayed event
    // has landed): stay on the consent screen, gated by gatewayReady below.
  }, [origin, screen, sessionState]);

  // The consent screen's buttons are gated on this: sending consent.granted
  // or consent.declined into a socket that is not open yet would be silently
  // dropped by GatewaySessionClient.send (see client.ts). For a JOINED
  // session this additionally waits for the replayed state to actually say
  // "awaiting-consent" — not just "the socket is open" — so a session that
  // turns out to already be running never flashes a clickable "I agree" for
  // consent it does not need (and the effect above would immediately route
  // away from anyway).
  const gatewayReady =
    gateway.state.connection === "open" && (origin === "created" || sessionState === "awaiting-consent");

  // The transport a joined session is ACTUALLY running on (reported by its
  // own session.state events) takes priority over the locally-selected one,
  // which only ever applied to a session this phone created.
  const effectiveTransport = gateway.state.transport ?? transport;

  return (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {screen === "setup" ? (
          <SetupScreen
            selected={transport}
            onSelect={setTransport}
            onContinue={startAttempt}
            joinSessionId={joinSessionId}
            onJoinSessionIdChange={setJoinSessionId}
            onJoin={startJoinAttempt}
          />
        ) : null}

        {screen === "consent" ? (
          <ConsentScreen
            ready={gatewayReady}
            error={gateway.state.lastError}
            onGrant={grantConsent}
            onDecline={declineConsent}
          />
        ) : null}

        {screen === "call" ? (
          <CallScreen
            transport={effectiveTransport}
            state={gateway.state}
            onEndCall={endCall}
            consentRecordedElsewhere={joinedAlreadyConsented}
          />
        ) : null}

        {screen === "summary" ? <SummaryScreen state={gateway.state} onStartNew={startNew} /> : null}
      </SafeAreaView>
    </CopilotKitProvider>
  );
}
