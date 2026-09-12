/**
 * One `LiveCallClient` per mount, exposed to React.
 *
 * `useSyncExternalStore` rather than a `useState` mirror: the client is the
 * single source of truth for the connection, and copying its state into React
 * would give a second one that can disagree during a reconnect.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { LiveCallClient, initialLiveCallState, type LiveCallState } from "./client";
import type { TranscriptSourceKind } from "./wire";

export function useLiveCall(): {
  state: LiveCallState;
  start: (transport?: TranscriptSourceKind) => void;
  grantConsent: () => void;
  declineConsent: () => void;
  end: () => void;
} {
  const client = useMemo(() => new LiveCallClient(), []);
  const server = useRef(initialLiveCallState());

  const subscribe = useCallback((listener: () => void) => client.subscribe(listener), [client]);
  const state = useSyncExternalStore(
    subscribe,
    () => client.getState(),
    // Web/SSR snapshot: a fresh state object every call would loop, so it is
    // the same frozen initial value every time.
    () => server.current,
  );

  // Leaving the screen drops the connection; it does not end the call, which
  // is the gateway's own state to keep.
  useEffect(() => () => client.close(), [client]);

  return {
    state,
    start: useCallback((transport?: TranscriptSourceKind) => void client.start(transport), [client]),
    grantConsent: useCallback(() => client.grantConsent(), [client]),
    declineConsent: useCallback(() => client.declineConsent(), [client]),
    end: useCallback(() => client.end(), [client]),
  };
}
