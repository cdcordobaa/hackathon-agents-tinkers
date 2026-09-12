/**
 * The live alert — the one part of Xentinela that is not a screen.
 *
 * Calls happen in the phone's own dialer, not in this app. Xentinela links to
 * the call; it does not host it. So a warning has to arrive on top of whatever
 * is on screen, which is what this provider drives: one alert at a time,
 * rendered by `AlertOverlay` above every tab and every pushed route.
 *
 * The three levels are three degrees of interruption, and nothing else:
 *
 *   low       a strip at the top. The call is not interrupted.
 *   elevated  the screen is blocked and a decision is asked for.
 *   high      the screen is taken and the call is cut on a countdown.
 *
 * `none` — the fourth level the model returns — has no UI here on purpose. An
 * alert that says "nothing is wrong" teaches people to ignore the ones that
 * matter.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useStore, type Verdict } from "./store";

export type AlertLevel = "low" | "elevated" | "high";

/**
 * `ending` and `ended` are separate because they are separate claims: one says
 * the app has asked for the call to stop, the other says it has stopped. Only
 * the second one is safe to show as a fact.
 */
export type AlertPhase = "open" | "ending" | "ended";

export type AlertSignal = {
  /** The tactic, in the user's words. */
  label: string;
  /** What the caller actually said. A signal without a quote is not shown. */
  quote: string;
};

/**
 * Who owns the call record this alert resolves into.
 *
 * `demo` alerts are self-contained: they invent a caller and file their own
 * record. A `live` alert is a view onto a session the LiveCall screen is
 * holding — that screen writes the record when the session ends, so filing one
 * here too would put the same call in Activity twice.
 */
export type AlertOrigin = "demo" | "live";

export type LiveAlert = {
  id: string;
  level: AlertLevel;
  phase: AlertPhase;
  origin: AlertOrigin;
  /** The dialer this is drawn over. Xentinela never owns the call. */
  app: string;
  caller: string;
  number: string;
  headline: string;
  /** One action, present from `elevated` up. Empty at `low`: context, not orders. */
  advice: string;
  signals: AlertSignal[];
  /** Seconds left before the call is cut. `high` only. */
  countdown: number;
  /** The record written when this alert resolved, so the UI can link to it. */
  loggedCallId?: string;
};

/** How long a low alert stays up before it closes itself. */
const LOW_DISMISS_MS = 8000;
/** The grace period before a high alert cuts the call. */
const CUT_SECONDS = 5;

type Script = Pick<LiveAlert, "caller" | "number" | "headline" | "advice" | "signals">;

/**
 * Stand-in content until the detection engine is wired in. Kept here rather
 * than in the overlay so the overlay has no copy of its own to drift from — it
 * renders whatever the engine sends, and this is what the engine will send.
 */
const scripts: Record<AlertLevel, Script> = {
  low: {
    caller: "Unknown",
    number: "+34 621 04 88 12",
    headline: "They are asking for details your bank already has.",
    advice: "",
    signals: [
      { label: "Data request", quote: "Confirm the last four digits of your card." },
    ],
  },
  elevated: {
    caller: "Unknown",
    number: "+34 621 04 88 12",
    headline: "You are being pushed to move money right now.",
    advice: "Do not transfer anything. Hang up and call the number on the back of your card.",
    signals: [
      { label: "Urgency", quote: "If we don't do this in ten minutes your account is frozen." },
      { label: "Unverified authority", quote: "This is the bank's security department." },
      { label: "Isolation", quote: "Don't mention this to your family until we're done." },
    ],
  },
  high: {
    caller: "Unknown",
    number: "+34 621 04 88 12",
    headline: "Xentinela is ending this call.",
    advice: "Your bank will never ask for a code you received by text.",
    signals: [
      { label: "One-time code", quote: "Read me the six digits you just got by text." },
      { label: "Moving funds", quote: "We'll move your balance to a safe account while we talk." },
    ],
  },
};

type Action =
  | { type: "raise"; level: AlertLevel; origin: AlertOrigin; content?: Partial<Script> }
  /** A later analyzer pass on the SAME call: new wording, possibly a new level. */
  | { type: "revise"; level: AlertLevel; content: Partial<Script> }
  | { type: "tick" }
  | { type: "ended"; callId: string }
  | { type: "clear" };

function reducer(alert: LiveAlert | null, action: Action): LiveAlert | null {
  switch (action.type) {
    case "raise":
      return {
        id: `a${Date.now()}`,
        level: action.level,
        phase: "open",
        origin: action.origin,
        app: "Phone",
        countdown: CUT_SECONDS,
        ...scripts[action.level],
        ...action.content,
      };

    // Risk is allowed to fall as well as rise — a pass that explains something
    // away lowers the score — so this follows the analyzer in both directions.
    // The countdown restarts only on the way UP into `high`: re-entering an
    // alert that is already counting down must not hand back the seconds.
    case "revise": {
      if (!alert || alert.phase !== "open") return alert;
      const escalating = action.level === "high" && alert.level !== "high";
      return {
        ...alert,
        ...action.content,
        level: action.level,
        countdown: escalating ? CUT_SECONDS : alert.countdown,
      };
    }

    case "tick": {
      if (!alert || alert.level !== "high" || alert.phase !== "open") return alert;
      const next = alert.countdown - 1;
      // Reaching zero only means the cut has been asked for. Whether the call
      // actually stopped is the next state, and it is not this timer's to say.
      if (next <= 0) return { ...alert, countdown: 0, phase: "ending" };
      return { ...alert, countdown: next };
    }

    case "ended":
      if (!alert) return alert;
      return { ...alert, phase: "ended", countdown: 0, loggedCallId: action.callId };

    case "clear":
      return null;
  }
}

type AlertStore = {
  alert: LiveAlert | null;
  /** True while the alert can be closed by a back gesture or a tap outside. */
  dismissible: boolean;
  raise: (level: AlertLevel) => void;
  /** Raise or revise the alert for the call the LiveCall screen is holding. */
  raiseLive: (level: AlertLevel, content: Partial<Script>) => void;
  /** Take the live alert down without filing anything — the session ended. */
  clear: () => void;
  /** What "hang up" should do while a live alert is up. LiveCall owns the
   *  session, so it owns the hanging up; the overlay only asks. */
  setLiveHangUp: (hangUp: (() => void) | undefined) => void;
  /** Close without a verdict of your own: "Got it", "Stay on the call". */
  dismiss: () => void;
  /** Hang up from the alert itself. */
  hangUp: () => void;
  /** Overrule the app: this call is fine. Stops a pending cut. */
  markLegitimate: () => void;
};

const AlertContext = createContext<AlertStore | null>(null);

export function AlertProvider({ children }: { children: ReactNode }) {
  const { guardians, dispatch: storeDispatch } = useStore();
  const [alert, dispatch] = useReducer(reducer, null);

  // Held in a ref so the effects below can read the current alert without
  // restarting their timers on every tick.
  const alertRef = useRef(alert);
  alertRef.current = alert;

  const guardianIds = useMemo(() => guardians.map((guardian) => guardian.id), [guardians]);

  // Set by LiveCall while it holds a session. A ref, not state, because the
  // timers below read it at the moment they fire, not at the moment they start.
  const liveHangUp = useRef<(() => void) | undefined>(undefined);

  const log = useCallback(
    (current: LiveAlert, verdict: Verdict, headline: string): string => {
      // A live alert's record belongs to the session, and LiveCall writes it
      // when that session ends. Writing one here would duplicate the call.
      if (current.origin === "live") return "";
      const id = `c${Date.now()}`;
      storeDispatch({
        type: "logCall",
        call: {
          id,
          caller: current.caller,
          number: current.number,
          day: "Today",
          time: new Date().toTimeString().slice(0, 5),
          durationSec: verdict === "blocked" ? 96 : 164,
          verdict,
          headline,
          signals: current.signals.map((signal) => `${signal.label}: “${signal.quote}”`),
          // Everyone is messaged at once, and only when there was something to
          // report. A call the user waved through alerts no one.
          alerted: verdict === "safe" ? [] : guardianIds,
          reported: false,
        },
      });
      return id;
    },
    [guardianIds, storeDispatch],
  );

  // A low alert closes itself. It exists to add context, and context that has
  // to be dismissed by hand is just another thing asking to be tapped.
  useEffect(() => {
    if (!alert || alert.level !== "low" || alert.phase !== "open") return;
    const timer = setTimeout(() => {
      const current = alertRef.current;
      if (current && current.level === "low") {
        log(current, "flagged", "Low signals");
        dispatch({ type: "clear" });
      }
    }, LOW_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [alert?.id, alert?.level, alert?.phase, log]);

  useEffect(() => {
    if (!alert || alert.level !== "high" || alert.phase !== "open") return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(timer);
  }, [alert?.id, alert?.level, alert?.phase]);

  // The gap between asking for the cut and confirming it. Short, but real —
  // the same gap the telephony provider will take once it is wired in.
  useEffect(() => {
    if (!alert || alert.phase !== "ending") return;
    const timer = setTimeout(() => {
      const current = alertRef.current;
      if (!current) return;
      if (current.origin === "live") liveHangUp.current?.();
      const callId = log(current, "blocked", "Ended automatically");
      dispatch({ type: "ended", callId });
    }, 1400);
    return () => clearTimeout(timer);
  }, [alert?.id, alert?.phase, log]);

  const value = useMemo<AlertStore>(() => {
    const dismissible =
      alert !== null && (alert.phase === "ended" || alert.level !== "high");

    return {
      alert,
      dismissible,
      raise: (level) => dispatch({ type: "raise", level, origin: "demo" }),
      raiseLive: (level, content) => {
        const current = alertRef.current;
        if (current?.origin === "live" && current.phase === "open") {
          dispatch({ type: "revise", level, content });
        } else if (!current) {
          dispatch({ type: "raise", level, origin: "live", content });
        }
      },
      clear: () => dispatch({ type: "clear" }),
      setLiveHangUp: (hangUp) => {
        liveHangUp.current = hangUp;
      },
      dismiss: () => {
        const current = alertRef.current;
        if (!current) return;
        if (current.phase !== "ended") {
          log(current, "flagged", current.level === "low" ? "Low signals" : "Urgency pressure");
        }
        dispatch({ type: "clear" });
      },
      // Hanging up yourself is not the same event as the app cutting the call,
      // and it must not be filed as one — `blocked` reads as "ended
      // automatically" everywhere else in the app.
      hangUp: () => {
        const current = alertRef.current;
        if (!current) return;
        if (current.origin === "live") liveHangUp.current?.();
        const callId = log(current, "flagged", "You ended the call");
        dispatch({ type: "ended", callId });
      },
      markLegitimate: () => {
        const current = alertRef.current;
        if (!current) return;
        log(current, "safe", "Marked safe by you");
        dispatch({ type: "clear" });
      },
    };
  }, [alert, log]);

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlert(): AlertStore {
  const store = useContext(AlertContext);
  if (!store) throw new Error("useAlert must be used inside AlertProvider");
  return store;
}

export { CUT_SECONDS };
