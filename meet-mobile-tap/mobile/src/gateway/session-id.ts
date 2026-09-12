/**
 * Mints a session id on the phone, before the gateway has ever heard of it —
 * "phone -> gateway WebSocket -> session" means the client picks the address
 * the socket connects to.
 *
 * Not `crypto.randomUUID()`: React Native gets `crypto.getRandomValues` from
 * Expo/CopilotKit polyfills, but `randomUUID` is not guaranteed, and pulling
 * in `react-native-get-random-values` for one id is a native dependency this
 * project is explicitly avoiding (see meet-mobile-tap/CLAUDE.md and this
 * task's own "adding a native module would break the working LiveKit iOS
 * build" instruction). This only needs to be unique enough to open one
 * gateway connection, not cryptographically random.
 */
let sequence = 0;

export function createSessionId(now: number = Date.now()): string {
  sequence += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `phone-${now}-${sequence}-${rand}`;
}
