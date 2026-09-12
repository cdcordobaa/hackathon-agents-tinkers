/**
 * Thin wrapper over `livekit-client`. Two participants in a LiveKit room IS a
 * real call (see the repo CLAUDE.md) — this file's only job is to surface
 * every participant's audio `MediaStreamTrack` (local included) to the
 * pipeline in ../participant-pipeline.ts, which is where transcription and
 * the level meter actually happen. Speaker separation is free here: LiveKit
 * already gives one track per participant, so there is no diarization step
 * anywhere in this app.
 */
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";

export type ParticipantAudio = {
  identity: string;
  isLocal: boolean;
  track: MediaStreamTrack;
};

export type RoomCallbacks = {
  onConnectionState: (state: ConnectionState) => void;
  /** Fires once per participant per published/subscribed audio track — local
   *  mic included, so the pipeline treats "you" the same way it treats
   *  everyone else. */
  onAudioTrack: (audio: ParticipantAudio) => void;
  /** A track went away — the participant left, or unpublished. */
  onAudioTrackEnded: (identity: string) => void;
  onRoster: (identities: string[]) => void;
  onError: (message: string) => void;
};

export type RoomHandle = {
  room: Room;
  disconnect: () => Promise<void>;
};

function roster(room: Room): string[] {
  const ids = [room.localParticipant.identity];
  room.remoteParticipants.forEach((participant: RemoteParticipant) => ids.push(participant.identity));
  return ids;
}

export async function joinRoom(url: string, token: string, cb: RoomCallbacks): Promise<RoomHandle> {
  const room = new Room({ adaptiveStream: false, dynacast: false });

  room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => cb.onConnectionState(state));

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind !== Track.Kind.Audio) return;
    cb.onAudioTrack({ identity: participant.identity, isLocal: false, track: track.mediaStreamTrack });
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    if (track.kind !== Track.Kind.Audio) return;
    cb.onAudioTrackEnded(participant.identity);
  });

  room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
    const track = publication.track;
    if (!track || track.kind !== Track.Kind.Audio || !track.mediaStreamTrack) return;
    cb.onAudioTrack({ identity: participant.identity, isLocal: true, track: track.mediaStreamTrack });
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
    if (publication.kind !== Track.Kind.Audio) return;
    cb.onAudioTrackEnded(participant.identity);
  });

  room.on(RoomEvent.ParticipantConnected, () => cb.onRoster(roster(room)));
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    cb.onAudioTrackEnded(participant.identity);
    cb.onRoster(roster(room));
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    cb.onError(`room disconnected${reason ? ` (${reason})` : ""}`);
  });

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  cb.onRoster(roster(room));

  return {
    room,
    disconnect: async () => {
      await room.disconnect();
    },
  };
}
