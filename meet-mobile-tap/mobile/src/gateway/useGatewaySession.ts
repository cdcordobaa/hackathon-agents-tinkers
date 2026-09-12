/**
 * React binding over GatewaySessionClient. One client per sessionId for the
 * lifetime of the component tree that holds it — a new sessionId (starting
 * over from the setup screen) gets a fresh client and a fresh socket.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { TranscriptSourceKind } from "../../../shared/src";
import { GatewaySessionClient } from "./client";

export function useGatewaySession(sessionId: string) {
  const client = useMemo(() => new GatewaySessionClient(sessionId), [sessionId]);

  const state = useSyncExternalStore(
    (onStoreChange) => client.subscribe(onStoreChange),
    () => client.getState(),
  );

  // Tear the socket down if the component holding this hook unmounts
  // without an explicit disconnect (e.g. the user backgrounds the app from
  // the call screen) — otherwise the backoff loop retries forever.
  useEffect(() => {
    return () => client.disconnect();
  }, [client]);

  return {
    state,
    start: (transport: TranscriptSourceKind) => client.start(transport),
    grantConsent: () => client.grantConsent(),
    declineConsent: () => client.declineConsent(),
    endSession: () => client.endSession(),
    disconnect: () => client.disconnect(),
  };
}
