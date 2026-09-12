/**
 * React binding over GatewaySessionClient. One client per `attemptKey` for
 * the lifetime of the component tree that holds it — bump the key (App.tsx
 * does this from the setup screen and from "start a new session" on the
 * summary screen) to get a fresh client, which is what triggers a fresh
 * `POST /session` on the next `start()` rather than reusing a session that
 * may already be `ended`.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { TranscriptSourceKind } from "../../../shared/src";
import { GatewaySessionClient } from "./client";

export function useGatewaySession(attemptKey: number | string) {
  const client = useMemo(() => new GatewaySessionClient(), [attemptKey]);

  const state = useSyncExternalStore(
    (onStoreChange) => client.subscribe(onStoreChange),
    () => client.getState(),
  );

  // Tear the socket down if the component holding this hook unmounts, or a
  // new attemptKey retires this client, without an explicit disconnect —
  // otherwise the backoff loop retries forever.
  useEffect(() => {
    return () => client.disconnect();
  }, [client]);

  return {
    state,
    start: (transport: TranscriptSourceKind) => client.start(transport),
    /** Attaches to a session someone else already created — see
     *  client.ts's `join()`. Never sends `session.start`. */
    join: (sessionId: string) => client.join(sessionId),
    grantConsent: () => client.grantConsent(),
    declineConsent: () => client.declineConsent(),
    endSession: () => client.endSession(),
    disconnect: () => client.disconnect(),
  };
}
