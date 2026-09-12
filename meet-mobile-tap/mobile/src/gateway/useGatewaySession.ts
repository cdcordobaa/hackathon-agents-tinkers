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

export function useGatewaySession(attemptKey: number | string, gatewayUrl?: string) {
  const client = useMemo(() => new GatewaySessionClient(gatewayUrl), [attemptKey, gatewayUrl]);

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
    getState: () => client.getState(),
    start: (transport: TranscriptSourceKind) => client.start(transport),
    grantConsent: () => client.grantConsent(),
    declineConsent: () => client.declineConsent(),
    endSession: () => client.endSession(),
    endSessionAndWait: (timeoutMs?: number) => client.endSessionAndWait(timeoutMs),
    disconnect: () => client.disconnect(),
  };
}
