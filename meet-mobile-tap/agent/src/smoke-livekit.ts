import type { AddressInfo } from "node:net";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { createDemoServer } from "./demo-server.ts";
import {
  MONITOR_IDENTITY,
  SESSION_TOPIC,
  parseCallSnapshot,
  type CallSnapshot,
} from "../../shared/session.ts";
import { pcmRms } from "./livekit-monitor-helpers.ts";

const LIVEKIT_URL = "ws://127.0.0.1:7880";
const LIVEKIT_HTTP_URL = "http://127.0.0.1:7880";
const API_KEY = "devkey";
const API_SECRET = "secret";
const ROOM_NAME = `secureguia-smoke-${process.pid}`;
const SAMPLE_RATE = 24_000;
const FRAME_MS = 20;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1_000;

type PublishedTone = {
  source: AudioSource;
  track: LocalAudioTrack;
};

for (const key of [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ANTHROPIC_API_KEY",
]) {
  delete process.env[key];
}

async function main(): Promise<void> {
  await waitForLiveKit();

  const logs: string[] = [];
  const gateway = createDemoServer({
    env: {
      LIVEKIT_URL,
      LIVEKIT_API_KEY: API_KEY,
      LIVEKIT_API_SECRET: API_SECRET,
    },
    onLog: (message) => logs.push(message),
  });
  const subjectRoom = new Room();
  const counterpartyRoom = new Room();
  let subjectTone: PublishedTone | undefined;
  let counterpartyTone: PublishedTone | undefined;

  try {
    await listen(gateway.server);
    const address = gateway.server.address() as AddressInfo;
    const gatewayUrl = `http://127.0.0.1:${address.port}`;

    const subjectJoin = await join(gatewayUrl, {
      identity: "smoke-subject",
      displayName: "Smoke Subject",
      role: "subject",
    });
    await connect(subjectRoom, subjectJoin.token);

    const counterpartyJoin = await join(gatewayUrl, {
      identity: "smoke-counterparty",
      displayName: "Smoke Counterparty",
      role: "counterparty",
    });
    await connect(counterpartyRoom, counterpartyJoin.token);

    const subjectHeardCounterparty = observeRemoteAudio(
      subjectRoom,
      "smoke-counterparty",
    );
    const counterpartyHeardSubject = observeRemoteAudio(
      counterpartyRoom,
      "smoke-subject",
    );
    const monitorObservedBoth = observeMonitorSnapshots(subjectRoom);

    subjectTone = await publishTone(subjectRoom, "subject-tone");
    counterpartyTone = await publishTone(counterpartyRoom, "counterparty-tone");

    await Promise.all([
      pumpTone(subjectTone.source, 440, 1_600, 2_500),
      pumpTone(counterpartyTone.source, 660, 2_200, 2_500),
    ]);

    const [subjectRms, counterpartyRms, snapshot] = await Promise.all([
      withTimeout(subjectHeardCounterparty, 5_000, "Subject did not receive counterparty PCM."),
      withTimeout(counterpartyHeardSubject, 5_000, "Counterparty did not receive subject PCM."),
      withTimeout(monitorObservedBoth, 5_000, "Monitor did not report both audio signals."),
    ]);

    assert(subjectRms > 100, "Subject received only silence from counterparty.");
    assert(counterpartyRms > 100, "Counterparty received only silence from subject.");
    assert(snapshot.profile === null, "Monitor fabricated a risk profile without model keys.");
    assert(snapshot.status === "degraded", "Missing model keys were not reported as degraded.");
    assert(
      /transcription unavailable/i.test(snapshot.detail) && /risk analysis unavailable/i.test(snapshot.detail),
      "Degraded snapshot did not explain both unavailable model capabilities.",
    );
    for (const identity of ["smoke-subject", "smoke-counterparty"]) {
      const participant = snapshot.participants.find((entry) => entry.id === identity);
      assert(participant?.hasAudio === true, `Monitor did not confirm audio for ${identity}.`);
      assert((participant?.level ?? 0) > 0, `Monitor reported zero level for ${identity}.`);
    }

    console.log(
      `local RTC smoke passed: two-way PCM observed; monitor saw 2/2 consented audio tracks; profile=null`,
    );
  } finally {
    await Promise.allSettled([
      subjectTone?.track.close() ?? Promise.resolve(),
      counterpartyTone?.track.close() ?? Promise.resolve(),
    ]);
    await Promise.allSettled([
      withTimeout(subjectRoom.disconnect(), 2_000, "Subject disconnect timed out."),
      withTimeout(counterpartyRoom.disconnect(), 2_000, "Counterparty disconnect timed out."),
    ]);
    await withTimeout(gateway.stop(), 10_000, "Gateway shutdown timed out.").catch(() => {});
    await dispose();
  }
}

async function waitForLiveKit(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(LIVEKIT_HTTP_URL, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The local process may still be opening its listening socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local LiveKit is not reachable at ${LIVEKIT_URL}.`);
}

async function listen(server: ReturnType<typeof createDemoServer>["server"]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function join(
  gatewayUrl: string,
  participant: {
    identity: string;
    displayName: string;
    role: "subject" | "counterparty";
  },
): Promise<{ token: string }> {
  const response = await fetch(`${gatewayUrl}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomName: ROOM_NAME,
      ...participant,
      consent: true,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Gateway join failed with HTTP ${response.status}.`);
  }
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string" && body.token.length > 0, "Gateway returned no token.");
  return { token: body.token };
}

async function connect(room: Room, token: string): Promise<void> {
  await withTimeout(
    room.connect(LIVEKIT_URL, token, { autoSubscribe: true, dynacast: false }),
    10_000,
    "Human RTC connection timed out.",
  );
}

async function publishTone(room: Room, name: string): Promise<PublishedTone> {
  assert(room.localParticipant, "Room has no local participant after connect.");
  const source = new AudioSource(SAMPLE_RATE, 1);
  const track = LocalAudioTrack.createAudioTrack(name, source);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await withTimeout(
    room.localParticipant.publishTrack(track, publishOptions),
    5_000,
    `Publishing ${name} timed out.`,
  );
  return { source, track };
}

async function pumpTone(
  source: AudioSource,
  frequency: number,
  amplitude: number,
  durationMs: number,
): Promise<void> {
  const frameCount = Math.ceil(durationMs / FRAME_MS);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const pcm = new Int16Array(FRAME_SAMPLES);
    const firstSample = frameIndex * FRAME_SAMPLES;
    for (let index = 0; index < pcm.length; index += 1) {
      pcm[index] = Math.round(
        Math.sin((2 * Math.PI * frequency * (firstSample + index)) / SAMPLE_RATE) * amplitude,
      );
    }
    await source.captureFrame(new AudioFrame(pcm, SAMPLE_RATE, 1, FRAME_SAMPLES));
  }
}

function observeRemoteAudio(room: Room, expectedIdentity: string): Promise<number> {
  return new Promise<number>((resolve) => {
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (participant.identity !== expectedIdentity || track.kind !== TrackKind.KIND_AUDIO) return;
      const stream = new AudioStream(track as RemoteTrack, { sampleRate: SAMPLE_RATE, numChannels: 1 });
      void (async () => {
        for await (const frame of stream) {
          const rms = pcmRms(frame.data);
          if (rms > 100) {
            resolve(rms);
            return;
          }
        }
      })();
    });
  });
}

function observeMonitorSnapshots(room: Room): Promise<CallSnapshot> {
  return new Promise<CallSnapshot>((resolve, reject) => {
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (participant?.identity !== MONITOR_IDENTITY || topic !== SESSION_TOPIC) return;
      const snapshot = parseCallSnapshot(new TextDecoder().decode(payload));
      if (!snapshot) return reject(new Error("Monitor published an invalid session snapshot."));
      if (snapshot.profile !== null) {
        return reject(new Error("Monitor published a profile despite cleared model keys."));
      }
      const heard = new Set(
        snapshot.participants
          .filter((entry) => entry.hasAudio && entry.level > 0)
          .map((entry) => entry.id),
      );
      if (heard.has("smoke-subject") && heard.has("smoke-counterparty")) resolve(snapshot);
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await main();
