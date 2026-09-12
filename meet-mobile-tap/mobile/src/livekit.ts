/**
 * One import surface for LiveKit, with or without native WebRTC.
 *
 * Expo Go ships a fixed native runtime and has no WebRTC in it, so importing
 * @livekit/react-native there is fatal. The library's own guard is
 * `if (WebRTCModule === null)`, but Expo Go leaves it `undefined`, so that
 * check does not fire and the failure lands further in — inside
 * NativeEventEmitter setup and RTCAudioSession — where it cannot be caught.
 * Hence testing for the module ourselves, before anything touches it.
 *
 * The test is for the capability, not for the environment: any runtime without
 * WebRTC gets the preview, and a dev build gets the real thing without either
 * side knowing which is which. App.tsx imports from here and stays one file.
 *
 * require() rather than import is the load-bearing detail. Metro bundles both
 * branches, but CommonJS requires are lazy, so only the branch taken is ever
 * evaluated — which is what keeps the real module from being touched in Expo
 * Go. Static ES imports would evaluate both and crash.
 */
import { NativeModules } from "react-native";

export const HAS_NATIVE_WEBRTC = Boolean(NativeModules.WebRTCModule);

/** True in Expo Go: the UI renders, the audio is fake. */
export const IS_PREVIEW = !HAS_NATIVE_WEBRTC;

// The real module is the source of truth for types; the preview is asserted to
// match. It implements only the slice App.tsx uses, so a structural check would
// fail on class identity (Participant, Room) that the mock has no way to
// satisfy. Anything added to the preview must still be added here by hand.
type LiveKitSurface = typeof import("./livekit-real");

const impl = (
  HAS_NATIVE_WEBRTC ? require("./livekit-real") : require("./livekit-preview")
) as LiveKitSurface;

export const AudioSession = impl.AudioSession;
export const LiveKitRoom = impl.LiveKitRoom;
export const useConnectionState = impl.useConnectionState;
export const useLocalParticipant = impl.useLocalParticipant;
export const useTracks = impl.useTracks;
export const useTrackVolume = impl.useTrackVolume;
export const registerGlobals = impl.registerGlobals;
export const ConnectionState = impl.ConnectionState;
export const Track = impl.Track;

export type { TrackReferenceOrPlaceholder } from "@livekit/react-native";
