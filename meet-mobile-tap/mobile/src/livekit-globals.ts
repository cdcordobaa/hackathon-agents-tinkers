/**
 * Installs LiveKit's WebRTC shims onto globalThis.
 *
 * This lives in its own module for one reason: ES imports are hoisted, so
 * calling registerGlobals() inside index.ts would still run *after* the
 * `import App` statement evaluated App.tsx — and livekit-client with it.
 * livekit-client expects RTCPeerConnection and mediaDevices to already exist
 * when it loads, so it has to win that race.
 *
 * Importing this module first in index.ts is what guarantees the ordering.
 */
import { registerGlobals } from "@livekit/react-native";

registerGlobals();
