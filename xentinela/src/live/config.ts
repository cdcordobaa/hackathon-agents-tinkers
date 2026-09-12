/**
 * Where the detection gateway is.
 *
 * `EXPO_PUBLIC_GATEWAY_URL` wins when set (see `.env`). Otherwise the host is
 * discovered rather than guessed: Metro already told this bundle which machine
 * it came from, and the gateway runs on that same machine. That is what makes
 * Expo Go on a physical phone work with no per-laptop edit — "localhost" there
 * means the phone, and a hardcoded LAN address goes stale the moment the
 * network hands out a different lease.
 *
 * Port 8787: the combined gateway in `meet-mobile-tap/agent` serves BOTH the
 * LiveKit demo routes and the `/session` protocol this app speaks, on one
 * port. Start it with `npm run dev` from `meet-mobile-tap`.
 */
import { NativeModules, Platform } from "react-native";

const GATEWAY_PORT = 8787;

/** The machine Metro served this bundle from — the dev laptop, by definition. */
function devHost(): string | undefined {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" ? window.location.hostname : undefined;
  }
  // e.g. "http://10.16.8.212:8088/index.bundle?platform=android"
  const scriptUrl: unknown = NativeModules?.SourceCode?.scriptURL;
  if (typeof scriptUrl !== "string") return undefined;
  const host = /^https?:\/\/([^/:]+)/.exec(scriptUrl)?.[1];
  // In a release build the bundle is on disk, so there is no host to take.
  return host && host !== "localhost" && host !== "127.0.0.1" ? host : undefined;
}

/** Last resort, when Metro told us nothing: the Android emulator reaches the
 *  host computer at 10.0.2.2, and only there. */
function fallbackHost(): string {
  return Platform.OS === "android" ? "10.0.2.2" : "localhost";
}

const configured = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim();

/** No trailing slash, so every call site can write `${GATEWAY_URL}/session`. */
export const GATEWAY_URL = (
  configured && configured.length > 0
    ? configured
    : `http://${devHost() ?? fallbackHost()}:${GATEWAY_PORT}`
).replace(/\/+$/, "");

/** The gateway serves its WebSocket on the same origin and port as its HTTP. */
export function sessionSocketUrl(sessionId: string): string {
  return `${GATEWAY_URL.replace(/^http/, "ws")}/session/${encodeURIComponent(sessionId)}`;
}
