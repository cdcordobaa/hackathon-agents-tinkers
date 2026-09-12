/**
 * Test doubles shared by this package's own tests. Not exported outside
 * server/ — a fake TranscriptSource under full manual control (no timers, no
 * fixture), and a stub model client identical in shape to the one
 * agent/src/analyzer.test.ts already uses, so a Session test never spends a
 * real API call.
 */
import type { AnalyzerOptions } from "../../agent/src/analyzer.ts";
import type { RiskProfile } from "../../agent/src/risk-profile.ts";
import type {
  Speaker,
  TranscriptSegment,
  TranscriptSource,
  TranscriptSourceStartContext,
  TranscriptSourceStopReason,
} from "../../shared/src/index.ts";

export class FakeTranscriptSource implements TranscriptSource {
  readonly kind = "replay" as const;
  startCalls = 0;
  stopReasons: TranscriptSourceStopReason[] = [];
  lastContext?: TranscriptSourceStartContext;

  private segmentCbs = new Set<(segment: TranscriptSegment) => void>();
  private speakerCbs = new Set<(speaker: Speaker) => void>();
  private endedCbs = new Set<(reason: TranscriptSourceStopReason) => void>();

  start(ctx: TranscriptSourceStartContext): void {
    this.startCalls += 1;
    this.lastContext = ctx;
  }

  stop(reason: TranscriptSourceStopReason): void {
    this.stopReasons.push(reason);
  }

  onSegment(cb: (segment: TranscriptSegment) => void) {
    this.segmentCbs.add(cb);
    return () => this.segmentCbs.delete(cb);
  }

  onSpeaker(cb: (speaker: Speaker) => void) {
    this.speakerCbs.add(cb);
    return () => this.speakerCbs.delete(cb);
  }

  onEnded(cb: (reason: TranscriptSourceStopReason) => void) {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  /** Test-only: push a segment straight to whoever is listening (Session),
   *  bypassing any real transport. */
  push(segment: TranscriptSegment): void {
    for (const cb of this.segmentCbs) cb(segment);
  }

  announce(speaker: Speaker): void {
    for (const cb of this.speakerCbs) cb(speaker);
  }

  end(reason: TranscriptSourceStopReason): void {
    for (const cb of this.endedCbs) cb(reason);
  }
}

export const STUB_PROFILE: RiskProfile = {
  risk: "low",
  score: 10,
  headline: "Nothing unusual yet.",
  signals: [],
  advice: "",
  changed: "First assessment.",
};

/** Same shape as agent/src/analyzer.test.ts's stubClient — records every
 *  call and always resolves immediately with STUB_PROFILE. */
export function stubAnalyzerClient(): AnalyzerOptions["client"] {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(STUB_PROFILE) } }] }),
      },
    },
  } as unknown as AnalyzerOptions["client"];
}

/** A segment with sensible defaults, so a test only names what it varies. */
export function segment(overrides: Partial<TranscriptSegment> & Pick<TranscriptSegment, "sequence" | "text">): TranscriptSegment {
  return {
    speakerId: "caller",
    role: "counterparty",
    isFinal: true,
    providerEventKey: `key-${overrides.sequence}`,
    atMs: 0,
    ...overrides,
  };
}

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
