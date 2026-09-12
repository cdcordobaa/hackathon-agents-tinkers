/**
 * All app state lives here, in memory. There is no backend yet and no
 * persistence — the detection engine will replace `seedCalls` and push new
 * records through `logCall`, and nothing else in the UI has to change.
 */
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";

export type Verdict = "safe" | "flagged" | "blocked";

export type CallRecord = {
  id: string;
  caller: string;
  number: string;
  /** Grouping header in Activity. The engine will derive this from a timestamp. */
  day: string;
  time: string;
  durationSec: number;
  verdict: Verdict;
  /** One short phrase: what the call was, in the user's words. */
  headline: string;
  signals: string[];
  /** Guardian ids alerted. Every guardian is alerted at once — no ordering. */
  alerted: string[];
  reported: boolean;
};

export type Guardian = {
  id: string;
  name: string;
  relationship: string;
};

type State = {
  protectionOn: boolean;
  calls: CallRecord[];
  guardians: Guardian[];
};

type Action =
  | { type: "toggleProtection" }
  /** A finished call, pushed in by the detection engine. Newest first. */
  | { type: "logCall"; call: CallRecord }
  | { type: "markSafe"; id: string }
  | { type: "report"; id: string }
  | { type: "addGuardian"; name: string; relationship: string }
  | { type: "removeGuardian"; id: string };

const seedGuardians: Guardian[] = [
  { id: "g1", name: "Lucía M.", relationship: "Daughter" },
  { id: "g2", name: "Javier R.", relationship: "Neighbour" },
];

const seedCalls: CallRecord[] = [
  {
    id: "c1",
    caller: "+34 621 04 88 12",
    number: "+34 621 04 88 12",
    day: "Today",
    time: "14:22",
    durationSec: 72,
    verdict: "blocked",
    headline: "Bank impersonation",
    signals: [
      "Asked for a verification code",
      "Claimed to be the fraud department",
      "Pushed to act immediately",
    ],
    alerted: ["g1", "g2"],
    reported: false,
  },
  {
    id: "c2",
    caller: "+34 911 22 07 43",
    number: "+34 911 22 07 43",
    day: "Today",
    time: "11:05",
    durationSec: 220,
    verdict: "flagged",
    headline: "Urgency pressure",
    signals: ["Refused to be called back", "Repeated time pressure"],
    alerted: ["g1", "g2"],
    reported: false,
  },
  {
    id: "c3",
    caller: "Marta",
    number: "+34 655 90 11 20",
    day: "Today",
    time: "09:40",
    durationSec: 485,
    verdict: "safe",
    headline: "No signals",
    signals: [],
    alerted: [],
    reported: false,
  },
  {
    id: "c4",
    caller: "Dentist",
    number: "+34 913 55 62 00",
    day: "Yesterday",
    time: "17:12",
    durationSec: 48,
    verdict: "safe",
    headline: "No signals",
    signals: [],
    alerted: [],
    reported: false,
  },
  {
    id: "c5",
    caller: "Unknown",
    number: "+44 20 7946 0102",
    day: "Yesterday",
    time: "12:31",
    durationSec: 96,
    verdict: "flagged",
    headline: "Package delivery pretext",
    signals: ["Asked for a payment to release a parcel", "Number spoofed from abroad"],
    alerted: ["g1", "g2"],
    reported: true,
  },
  {
    id: "c6",
    caller: "Farmacia Los Olivos",
    number: "+34 912 40 33 18",
    day: "Yesterday",
    time: "10:02",
    durationSec: 134,
    verdict: "safe",
    headline: "No signals",
    signals: [],
    alerted: [],
    reported: false,
  },
  {
    id: "c7",
    caller: "+34 600 71 45 09",
    number: "+34 600 71 45 09",
    day: "This week",
    time: "Mon 16:48",
    durationSec: 61,
    verdict: "flagged",
    headline: "Investment offer",
    signals: ["Promised guaranteed returns", "Asked to move money today"],
    alerted: ["g1", "g2"],
    reported: false,
  },
  {
    id: "c8",
    caller: "Carlos",
    number: "+34 677 12 88 40",
    day: "This week",
    time: "Mon 09:15",
    durationSec: 742,
    verdict: "safe",
    headline: "No signals",
    signals: [],
    alerted: [],
    reported: false,
  },
];

const initialState: State = {
  protectionOn: true,
  calls: seedCalls,
  guardians: seedGuardians,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "toggleProtection":
      return { ...state, protectionOn: !state.protectionOn };

    // The seam the README promises: the engine pushes a record and every
    // screen picks it up unchanged. Prepended, because Activity and the
    // Shield's "recent" list both read the front of this array as newest.
    case "logCall":
      return { ...state, calls: [action.call, ...state.calls] };

    // Marking safe is the user overruling the model. It clears the verdict and
    // the signals with it — leaving them would say "we still think you're wrong".
    case "markSafe":
      return {
        ...state,
        calls: state.calls.map((call) =>
          call.id === action.id
            ? { ...call, verdict: "safe", headline: "Marked safe by you", signals: [] }
            : call,
        ),
      };

    case "report":
      return {
        ...state,
        calls: state.calls.map((call) =>
          call.id === action.id ? { ...call, reported: true } : call,
        ),
      };

    case "addGuardian":
      return {
        ...state,
        guardians: [
          ...state.guardians,
          {
            id: `g${Date.now()}`,
            name: action.name.trim(),
            relationship: action.relationship.trim() || "Contact",
          },
        ],
      };

    case "removeGuardian":
      return {
        ...state,
        guardians: state.guardians.filter((guardian) => guardian.id !== action.id),
      };
  }
}

type Store = State & {
  stats: { total: number; flagged: number; blocked: number };
  guardianById: (id: string) => Guardian | undefined;
  callById: (id: string) => CallRecord | undefined;
  dispatch: (action: Action) => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo<Store>(() => {
    return {
      ...state,
      stats: {
        total: state.calls.length,
        flagged: state.calls.filter((call) => call.verdict === "flagged").length,
        blocked: state.calls.filter((call) => call.verdict === "blocked").length,
      },
      guardianById: (id) => state.guardians.find((guardian) => guardian.id === id),
      callById: (id) => state.calls.find((call) => call.id === id),
      dispatch,
    };
  }, [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
