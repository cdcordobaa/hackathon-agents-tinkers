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

/**
 * The CopilotKit runtime the in-call assistant talks to. Defaults to a path
 * on the same gateway so there is exactly one backend to stand up for the
 * whole app; add-copilot-fraud-assistant's design.md leaves open whether
 * this ends up being the gateway itself or the workspace's existing
 * claude-agent-server AG-UI bridge — either is a same-shape URL swap here.
 *
 * Per the assistant spec's "No provider credentials on the device"
 * requirement, this is a URL, never a model key.
 */
export const RUNTIME_URL = process.env.EXPO_PUBLIC_RUNTIME_URL ?? `${GATEWAY_URL}/copilotkit`;

/** ws(s) URL for one session's event stream, per shared/'s "phone -> gateway
 *  WebSocket -> session" design: one session per socket, addressed by the
 *  connection itself, so the id lives in the path and not in any message. */
export function buildSessionWsUrl(sessionId: string): string {
  const wsBase = GATEWAY_URL.replace(/^http/, "ws");
  return `${wsBase}/session/${encodeURIComponent(sessionId)}`;
}
