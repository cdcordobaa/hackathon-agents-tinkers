import LiveCallApp from "./LiveCallApp";
import SessionApp from "./SessionApp";

const experience = process.env.EXPO_PUBLIC_CALL_EXPERIENCE?.trim().toLowerCase();

/**
 * Keep the gateway-issued LiveKit demo as the default. The session-event
 * experience remains available while its protocol is reconciled separately.
 */
export default function App() {
  return experience === "session" ? <SessionApp /> : <LiveCallApp />;
}
