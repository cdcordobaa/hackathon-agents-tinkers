/**
 * The seam between a live session and the rest of the app.
 *
 * Two things have to happen while a call is being analysed, and neither of
 * them belongs to the screen drawing the transcript: the alert overlay has to
 * follow the analyzer, and the finished call has to land in Activity next to
 * every other one. Both are effects on `GatewayState`, so both live here.
 */
import { useEffect, useRef } from "react";
import { useAlert, type AlertLevel } from "./alerts";
import { useStore } from "./store";
import { verdictFor } from "./screens/CallSurface";
import type { GatewayState } from "./gateway/reducer";
import type { RiskProfile } from "../../shared/src";

/** The analyzer's four levels, and the three degrees of interruption. `none`
 *  has no alert on purpose: a warning that says "nothing is wrong" teaches
 *  people to ignore the ones that matter. */
function alertLevelFor(risk: RiskProfile["risk"]): AlertLevel | null {
  if (risk === "high") return "high";
  if (risk === "elevated") return "elevated";
  if (risk === "low") return "low";
  return null;
}

/**
 * Raise and revise the alert overlay from the analyzer's passes, and hand the
 * overlay a way to hang up that actually reaches this session.
 *
 * `onHangUp` is held by the provider in a ref, so a high alert's countdown
 * ends the real call rather than only drawing a countdown about it.
 */
export function useLiveAlert(
  state: GatewayState,
  { active, onHangUp }: { active: boolean; onHangUp: () => void },
): void {
  const { raiseLive, clear, setLiveHangUp } = useAlert();

  useEffect(() => {
    if (!active) return;
    setLiveHangUp(onHangUp);
    return () => setLiveHangUp(undefined);
  }, [active, onHangUp, setLiveHangUp]);

  const profile = state.profile;
  const running = state.sessionState === "running";

  useEffect(() => {
    if (!active || !profile || !running) return;
    const level = alertLevelFor(profile.risk);
    if (!level) return;
    raiseLive(level, {
      caller: state.transport === "replay" ? "Unknown" : "Live call",
      number: state.sessionId ? `session ${state.sessionId.slice(0, 8)}` : "—",
      headline: profile.headline,
      // `low` carries no instruction — it is context, not orders.
      advice: level === "low" ? "" : profile.advice,
      signals: profile.signals.map((signal) => ({ label: signal.type, quote: signal.quote })),
    });
  }, [active, profile, running, state.transport, state.sessionId, raiseLive]);

  // The call is over; the warning drawn over it has nothing left to warn about.
  useEffect(() => {
    if (active && state.sessionState === "ended") clear();
  }, [active, state.sessionState, clear]);
}

/**
 * Write a finished call into the store, exactly once.
 *
 * Keyed on `sessionId` rather than a boolean so a second call in the same
 * app run is still recorded, and a re-render during teardown is not.
 */
export function useLoggedCall(state: GatewayState | undefined, ended: boolean): void {
  const { guardians, dispatch } = useStore();
  const written = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!ended || !state) return;
    const key = state.sessionId ?? "no-session";
    if (written.current === key) return;
    const final = state.profile ?? state.peak;
    // Nothing was heard and nothing was judged: there is no call to file.
    if (state.turns.length === 0 && !final) return;
    written.current = key;

    const verdict = verdictFor(final?.risk);
    const lastAt = state.turns.length > 0 ? state.turns[state.turns.length - 1]!.atMs : 0;
    dispatch({
      type: "logCall",
      call: {
        id: `c${Date.now()}`,
        caller: state.transport === "replay" ? "Unknown number" : "Live call",
        number: state.sessionId ? `session ${state.sessionId.slice(0, 8)}` : "—",
        day: "Today",
        time: new Date().toTimeString().slice(0, 5),
        durationSec: Math.round(lastAt / 1000),
        verdict,
        headline: final?.headline ?? "No assessment",
        signals: (final?.signals ?? []).map((signal) => `${signal.type}: “${signal.quote}”`),
        // Everyone at once, and only when there was something to tell them.
        alerted: verdict === "safe" ? [] : guardians.map((guardian) => guardian.id),
        reported: false,
      },
    });
  }, [ended, state, guardians, dispatch]);
}
