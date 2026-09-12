/**
 * Adapted from
 * ../../../agents-everywhere-starter-kit/apps/web/src/lib/stereo-capture.ts
 * (MIT, same workspace) — the mono half of that file's stereo-tap trick, with
 * no merge step. That file merges mic + tab into one stereo graph so both
 * channels are sample-aligned from the same render quantum; that problem
 * does not exist here, because LiveKit already hands this app one separate
 * `MediaStreamTrack` per participant, so there is nothing to align. This is
 * an adaptation, not a copy: single input, single output, and a level meter
 * folded into the same graph (the original had no use for one).
 *
 * Why a level meter lives here and not in the UI layer: per this project's
 * CLAUDE.md, silence is the expected failure mode and it is indistinguishable
 * from a working, quiet room unless something measures the signal itself. An
 * AnalyserNode tapped off the same source the transcription feed reads from
 * is the only way to be sure the meter reflects what the model is actually
 * hearing, not just "a track exists."
 */

/** What the Realtime transcription session wants. Asking the AudioContext for
 *  it makes the browser's own resampler do the conversion for free. */
const TARGET_SAMPLE_RATE = 24_000;

/** ~100 ms per message — one message per 20 ms frame would spend more time in
 *  WebSocket overhead than in audio. */
const FRAME_MS = 100;

const WORKLET_SOURCE = `
class MonoTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frame = options.processorOptions.frameSamples;
    this.buf = new Int16Array(this.frame);
    this.used = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.buf[this.used] = s < -1 ? -32768 : s > 1 ? 32767 : (s * 32767) | 0;
      this.used++;

      if (this.used === this.frame) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        // The buffer is gone after a transfer — allocate a fresh one.
        this.buf = new Int16Array(this.frame);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("mono-tap", MonoTap);
`;

export type TrackTapHandle = {
  /** The rate the browser actually gave us. Pass it to whatever consumes the
   *  PCM — do not assume it equals TARGET_SAMPLE_RATE. */
  sampleRate: number;
  /** RMS of the most recent analyser window, 0..~1. Cheap enough to poll on
   *  every animation frame. */
  getLevel: () => number;
  stop: () => void;
};

/**
 * Taps one live MediaStreamTrack: PCM16 mono frames to `onFrame` for
 * transcription, plus a level meter for the operator screen. One AudioContext
 * per track — for a two- or three-participant demo call that is cheap; it is
 * not meant to scale to a large room.
 */
export async function startTrackTap(
  track: MediaStreamTrack,
  onFrame: (pcm: Int16Array) => void,
): Promise<TrackTapHandle> {
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const frameSamples = Math.round((context.sampleRate * FRAME_MS) / 1000);

  // A MediaStreamTrack cannot be tapped directly — MediaStreamAudioSourceNode
  // wants the MediaStream it lives on.
  const stream = new MediaStream([track]);
  const source = context.createMediaStreamSource(stream);

  const tap = new AudioWorkletNode(context, "mono-tap", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: { frameSamples },
  });
  tap.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const timeDomain = new Float32Array(analyser.fftSize);

  // A worklet only runs while the graph is being pulled toward a destination.
  // Routing through a muted gain node guarantees that without making the page
  // play the call back over itself.
  const silence = context.createGain();
  silence.gain.value = 0;

  source.connect(tap);
  source.connect(analyser);
  tap.connect(silence);
  silence.connect(context.destination);

  let stopped = false;
  return {
    sampleRate: context.sampleRate,
    getLevel() {
      if (stopped) return 0;
      analyser.getFloatTimeDomainData(timeDomain);
      let sumSquares = 0;
      for (const sample of timeDomain) sumSquares += sample * sample;
      return Math.sqrt(sumSquares / timeDomain.length);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      tap.port.onmessage = null;
      try {
        source.disconnect();
        tap.disconnect();
        analyser.disconnect();
        silence.disconnect();
      } catch {
        // Already torn down by a context close — nothing to do.
      }
      void context.close();
    },
  };
}
