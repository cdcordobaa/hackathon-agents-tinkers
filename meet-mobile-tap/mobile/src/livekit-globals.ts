/**
 * Installs LiveKit's WebRTC shims onto globalThis, before anything needs them.
 *
 * ES imports are hoisted, so calling registerGlobals() inside index.ts would
 * still run *after* `import App` had evaluated App.tsx — and livekit-client
 * with it. livekit-client expects RTCPeerConnection and mediaDevices to exist
 * when it loads, so it has to win that race. Importing this module first in
 * index.ts is what guarantees the ordering.
 *
 * The registration itself now lives in ./livekit-real, which requires
 * @livekit/react-native, calls registerGlobals(), and only then requires
 * livekit-client — in that statement order, for the same hoisting reason. This
 * module stays as the explicit anchor for that contract at the app entry point.
 *
 * In Expo Go there is no native WebRTC to register, so ./livekit resolves to
 * the preview and this import does nothing.
 */
import "./livekit";
