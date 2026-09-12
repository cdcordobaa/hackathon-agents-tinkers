/**
 * The real LiveKit surface — native WebRTC, actual call audio.
 *
 * Loaded by ./livekit only when NativeModules.WebRTCModule exists, i.e. in a
 * dev build or a release build. Requiring this module in Expo Go throws.
 *
 * Why require() and not import: the ordering invariant from ./livekit-globals
 * has to hold *inside* this module too. ES imports are hoisted, so an
 * `import { registerGlobals }` here would still let livekit-client evaluate
 * before registerGlobals() ran. CommonJS requires execute in statement order,
 * which is the only way to guarantee the globals are installed first.
 *
 * The `typeof import(...)` annotations are type-only and erased at build time,
 * so they buy back full typing without adding a runtime import.
 */
const rn: typeof import("@livekit/react-native") = require("@livekit/react-native");

// Must happen before livekit-client is evaluated on the next line.
rn.registerGlobals();

const client: typeof import("livekit-client") = require("livekit-client");

export const AudioSession = rn.AudioSession;
export const LiveKitRoom = rn.LiveKitRoom;
export const useConnectionState = rn.useConnectionState;
export const useLocalParticipant = rn.useLocalParticipant;
export const useTracks = rn.useTracks;
export const useTrackVolume = rn.useTrackVolume;
export const registerGlobals = rn.registerGlobals;

export const ConnectionState = client.ConnectionState;
export const Track = client.Track;
