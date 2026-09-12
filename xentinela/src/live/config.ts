/**
 * Where the detection gateway is.
 *
 * `EXPO_PUBLIC_GATEWAY_URL` wins when set (see `.env`). The fallback is per
 * platform because "localhost" means a different machine on each one: on the
 * Android emulator the host computer is 10.0.2.2, and only there.
 */
import { Platform } from "react-native";

// 8788, not the gateway's own default 8787: the LiveKit demo gateway in
// meet-mobile-tap/agent already holds that port on this machine.
const fallback =
  Platform.OS === "android" ? "http://10.0.2.2:8788" : "http://localhost:8788";

const configured = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim();

/** No trailing slash, so every call site can write `${GATEWAY_URL}/session`. */
export const GATEWAY_URL = (configured && configured.length > 0 ? configured : fallback).replace(
  /\/+$/,
  "",
);

/** The gateway serves its WebSocket on the same origin and port as its HTTP. */
export function sessionSocketUrl(sessionId: string): string {
  return `${GATEWAY_URL.replace(/^http/, "ws")}/session/${encodeURIComponent(sessionId)}`;
}
