/**
 * Tab + mic stereo capture — the "in the room" tap.
 *
 * Two sources, one clock:
 *
 *   getUserMedia(mic)     ──▶ merger input 0  (LEFT  — you)
 *   getDisplayMedia(tab)  ──▶ merger input 1  (RIGHT — them)
 *                                   │
 *                             AudioWorklet ──▶ Int16 PCM per channel
 *
 * Why merge into stereo and then split again, rather than tapping each source
 * separately: both channels are then filled inside the same render quantum, so
 * the two PCM buffers are sample-aligned by construction. That is what lets the
 * transcript interleave honestly — without it, "who spoke first" is decided by
 * whichever WebSocket happened to flush first.
 *
 * It also means speaker separation costs nothing. No diarization, no guessing:
 * the left channel IS you and the right channel IS them, because that is how
 * they were captured.
 */

/** What the Realtime API wants. Asking the AudioContext for it makes the
 *  browser's own resampler do the 48k → 24k conversion for free. */
const TARGET_SAMPLE_RATE = 24_000;

/** ~100 ms per message. One message per 20 ms frame would spend more time in
 *  WebSocket overhead than in audio. */
const FRAME_MS = 100;

export type CaptureChannel = "you" | "them";

export type StereoCaptureHandle = {
  /** The rate the browser actually gave us. Pass it to whatever consumes the
   *  PCM — do not assume it equals TARGET_SAMPLE_RATE. */
  sampleRate: number;
  stop: () => void;
};

export type StereoCaptureOptions = {
  /** ~100 ms of mono PCM16 for one speaker, at `sampleRate`. */
  onAudio: (channel: CaptureChannel, pcm: Int16Array) => void;
  /** The user hit "Stop sharing" in Chrome's bar, or the tab closed. */
  onEnded?: () => void;
};

/**
 * Runs inside the audio thread. Accumulates each channel separately and posts
 * whole frames, transferring the buffers so nothing is copied.
 */
const WORKLET_SOURCE = `
class StereoTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frame = options.processorOptions.frameSamples;
    this.left = new Int16Array(this.frame);
    this.right = new Int16Array(this.frame);
    this.used = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const left = input[0];
    // Before the tab track delivers its first block the merger reports one
    // channel. Treat the missing side as silence rather than duplicating you
    // into them.
    const right = input.length > 1 ? input[1] : null;
    if (!left) return true;

    for (let i = 0; i < left.length; i++) {
      const l = left[i];
      const r = right ? right[i] : 0;
      this.left[this.used] = l < -1 ? -32768 : l > 1 ? 32767 : (l * 32767) | 0;
      this.right[this.used] = r < -1 ? -32768 : r > 1 ? 32767 : (r * 32767) | 0;
      this.used++;

      if (this.used === this.frame) {
        this.port.postMessage(
          { left: this.left, right: this.right },
          [this.left.buffer, this.right.buffer],
        );
        // The buffers are gone after a transfer — allocate fresh ones.
        this.left = new Int16Array(this.frame);
        this.right = new Int16Array(this.frame);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("stereo-tap", StereoTap);
`;

export async function startStereoCapture({
  onAudio,
  onEnded,
}: StereoCaptureOptions): Promise<StereoCaptureHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("This browser has no getDisplayMedia. Tab audio capture needs desktop Chrome or Edge.");
  }

  // Ask for video even though we only want audio: Chrome does not offer the
  // "Also share tab audio" checkbox for an audio-only request, so an audio-only
  // ask succeeds and hands back a stream with no audio track at all.
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      // Never process the far end. Echo cancellation and AGC on captured tab
      // audio chew up exactly the signal the model is meant to hear.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const stopDisplay = () => display.getTracks().forEach((track) => track.stop());

  if (display.getAudioTracks().length === 0) {
    stopDisplay();
    throw new Error(
      'That share had no audio. Pick the tab again and tick "Also share tab audio" in the picker.',
    );
  }

  // We only ever wanted sound. Dropping the video track stops Chrome encoding
  // frames nobody looks at.
  for (const track of display.getVideoTracks()) {
    track.stop();
    display.removeTrack(track);
  }

  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Keep cancellation ON here. If the call is coming out of speakers
        // rather than headphones, the mic hears the far end too, and without
        // this "them" bleeds into the "you" channel and both transcripts
        // double up.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (cause) {
    stopDisplay();
    throw cause;
  }

  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

  const moduleUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const frameSamples = Math.round((context.sampleRate * FRAME_MS) / 1000);

  const micSource = context.createMediaStreamSource(mic);
  const tabSource = context.createMediaStreamSource(display);
  const merger = context.createChannelMerger(2);

  micSource.connect(merger, 0, 0); // left  — you
  tabSource.connect(merger, 0, 1); // right — them

  const tap = new AudioWorkletNode(context, "stereo-tap", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    // "discrete" keeps the two channels apart. The default would helpfully
    // downmix them to mono and throw away the separation we just built.
    channelInterpretation: "discrete",
    processorOptions: { frameSamples },
  });

  tap.port.onmessage = (event: MessageEvent<{ left: Int16Array; right: Int16Array }>) => {
    onAudio("you", event.data.left);
    onAudio("them", event.data.right);
  };

  // A worklet only runs while the graph is being pulled toward a destination.
  // Routing through a muted gain node guarantees that without making the page
  // play the call back over itself.
  const silence = context.createGain();
  silence.gain.value = 0;
  merger.connect(tap);
  tap.connect(silence);
  silence.connect(context.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    tap.port.onmessage = null;
    for (const track of [...display.getTracks(), ...mic.getTracks()]) track.stop();
    try {
      micSource.disconnect();
      tabSource.disconnect();
      merger.disconnect();
      tap.disconnect();
      silence.disconnect();
    } catch {
      // Already torn down by a context close — nothing to do.
    }
    void context.close();
  };

  // Chrome's "Stop sharing" bar ends the track without telling the page
  // anything else. Without this the UI sits there claiming to be live.
  for (const track of display.getAudioTracks()) {
    track.addEventListener("ended", () => {
      stop();
      onEnded?.();
    });
  }

  return { sampleRate: context.sampleRate, stop };
}
