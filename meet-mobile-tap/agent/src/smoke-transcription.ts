/** Real-provider verification. Pass two consented 24kHz mono PCM16 WAV recordings.
 * Creates an isolated LiveKit room and cleans it up without opening an HTTP port. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { AudioFrame, AudioSource, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource, dispose } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { acceptRoomSnapshot, initialRoomSession } from "../../shared/room-session.ts";
import { createLiveKitMonitor } from "./livekit-monitor.ts";
import { readWav } from "./transcribe-file.ts";

const url = process.env.LIVEKIT_URL!;
const apiKey = process.env.LIVEKIT_API_KEY!;
const apiSecret = process.env.LIVEKIT_API_SECRET!;
assert(url && apiKey && apiSecret && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), "Configure LiveKit and Gemini in agent/.env.");
const files = process.argv.slice(2);
assert.equal(files.length, 2, "Pass the counterparty WAV, followed by the protected person's WAV.");
const recordings = files.map((file) => readWav(readFileSync(file)));
assert(recordings.every((audio) => audio.sampleRate === 24_000), "Use 24kHz mono WAV recordings.");
const roomName = `stt-check-${Date.now().toString(36)}`;
const service = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
const actors: { room: Room; source?: AudioSource; track?: LocalAudioTrack; sid?: string }[] = [];
let monitor: Awaited<ReturnType<typeof createLiveKitMonitor>> | undefined;
let receiver = initialRoomSession();
const seenTurns = new Set<string>();
let startedAudio = 0;
let firstTurnMs: number | undefined;
let lastDetail = "";
let droppedAudio = false;
let transcriptCompletedAt = 0;

try {
  // Report only names and counts, never connection credentials.
  const existing = await service.listRooms();
  console.log("Existing rooms:", JSON.stringify(existing.map((room) => ({ name: room.name, participants: room.numParticipants }))));
  console.log(`Isolated transcription check: ${roomName}`);
  monitor = await createLiveKitMonitor({ url, apiKey, apiSecret, roomName,
    onLog: (message) => {
      if (/backlog full|chunk was omitted/i.test(message)) droppedAudio = true;
      if (!message.startsWith("Audio ") && !message.startsWith("Silent chunk")) console.log(message);
    },
  });
  for (const role of ["counterparty", "subject"] as const) {
    const room = new Room();
    actors.push({ room });
    if (role === "subject") {
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        receiver = acceptRoomSnapshot(receiver, { payload, senderIdentity: participant?.identity, topic, roomName });
        const snapshot = receiver.snapshot;
        if (!snapshot) return;
        if (snapshot.status === "degraded" && snapshot.detail !== lastDetail) {
          console.log(`Monitor degraded: ${snapshot.detail}`);
          lastDetail = snapshot.detail;
        }
        for (const turn of snapshot.turns) {
          if (seenTurns.has(turn.id)) continue;
          seenTurns.add(turn.id);
          firstTurnMs ??= Date.now() - startedAudio;
          transcriptCompletedAt = Date.now();
          console.log(JSON.stringify({ speaker: turn.speakerName, text: turn.text, receivedAfterMs: Date.now() - startedAudio }));
        }
      });
    }
    const token = new AccessToken(apiKey, apiSecret, { identity: `check-${role}`, name: role,
      ttl: "5m", metadata: JSON.stringify({ role, displayName: role, consent: true, consentedAt: Date.now() }),
    });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    await room.connect(url, await token.toJwt(), { autoSubscribe: true, dynacast: false });
    const actor = actors.at(-1)!;
    actor.source = new AudioSource(24_000, 1);
    actor.track = LocalAudioTrack.createAudioTrack(`recorded-${role}`, actor.source);
    const publish = new TrackPublishOptions();
    publish.source = TrackSource.SOURCE_MICROPHONE;
    const publication = await room.localParticipant!.publishTrack(actor.track, publish);
    actor.sid = publication.sid;
  }
  await delay(800);
  startedAudio = Date.now();
  for (let speaker = 0; speaker < actors.length; speaker++) {
    const actor = actors[speaker]!;
    const audio = recordings[speaker]!;
    for (let i = 0; i < audio.pcm.length; i += 480) {
      const pcm = new Int16Array(480);
      pcm.set(audio.pcm.subarray(i, i + 480));
      await actor.source!.captureFrame(new AudioFrame(pcm, 24_000, 1, 480));
    }
    await actor.source!.waitForPlayout();
    await delay(200); // Allow the final RTP packets to reach the monitor before flushing.
    await actor.room.localParticipant!.unpublishTrack(actor.sid!, true);
    await delay(450);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snapshot = receiver.snapshot;
    const speakers = new Set(snapshot?.turns.map((turn) => turn.speakerId));
    if (speakers.has("check-subject") && speakers.has("check-counterparty") && snapshot?.profile && snapshot.status === "waiting" && Date.now() - transcriptCompletedAt > 2_000) break;
    await delay(500);
  }
  const snapshot = receiver.snapshot;
  const speakers = new Set(snapshot?.turns.map((turn) => turn.speakerId));
  assert(speakers.has("check-subject") && speakers.has("check-counterparty"), `Both voices must reach the shared web/mobile receiver. ${lastDetail}`);
  assert(snapshot?.profile, `No real risk assessment arrived. ${lastDetail}`);
  assert.notEqual(snapshot.status, "degraded", snapshot.detail);
  assert.equal(droppedAudio, false, "The real-provider check dropped audio; do not report this as a complete transcript.");
  console.log(JSON.stringify({ result: "passed", firstTurnMs, turns: snapshot.turns.length, risk: snapshot.profile.risk, score: snapshot.profile.score, roomName }));
} finally {
  await Promise.allSettled(actors.map(async (actor) => {
    await actor.track?.close();
    await actor.source?.close();
    await actor.room.disconnect();
  }));
  await monitor?.stop();
  await service.deleteRoom(roomName).catch(() => {});
  await dispose();
}
