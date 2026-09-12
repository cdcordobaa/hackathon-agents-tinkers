/**
 * The gateway endpoint.
 *
 * `localhost` on a phone means the PHONE, not your laptop — copied from
 * ../../agents-everywhere-starter-kit/apps/mobile/src/config.ts because this
 * exact mistake is the single most common way a working gateway looks dead
 * from a device:
 *
 *   iOS Simulator      -> http://localhost:8787
 *   Android emulator   -> http://10.0.2.2:8787
 *   Physical device    -> http://<your-laptop-LAN-IP>:8787
 *
 * Set EXPO_PUBLIC_GATEWAY_URL in mobile/.env to override. Expo only bakes
 * EXPO_PUBLIC_ vars in at bundle time, so a running Metro will not pick up a
 * new .env on its own — restart it with --clear after changing this.
 */
export const GATEWAY_URL = (process.env.EXPO_PUBLIC_GATEWAY_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);

/** Optional assistant runtime. Keep the Assistant tab absent until this
 * public URL explicitly names a working runtime; provider keys stay server-side. */
export const COPILOTKIT_RUNTIME_URL = process.env.EXPO_PUBLIC_COPILOTKIT_RUNTIME_URL?.trim() || undefined;

/** ws(s) URL for one session's event stream, per shared/'s "phone -> gateway
 *  WebSocket -> session" design: one session per socket, addressed by the
 *  connection itself, so the id lives in the path and not in any message. */
export function buildSessionWsUrl(sessionId: string, gatewayUrl = GATEWAY_URL): string {
  const wsBase = gatewayUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${wsBase}/session/${encodeURIComponent(sessionId)}`;
}
