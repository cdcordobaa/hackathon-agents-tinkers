/**
 * The rolling transcript.
 *
 * Streaming STT gives you two kinds of event: deltas that arrive while someone
 * is still talking, and a final when the turn closes. Only finals go into the
 * transcript — deltas get revised constantly, and analysing revised text makes
 * the model argue with itself between passes.
 *
 * Two things here are not obvious:
 *
 * 1. Growth is the whole problem. "Concatenate every few seconds" is fine for
 *    ten minutes and fatal for an hour, because the prompt grows without bound
 *    and every pass re-pays for it. `render()` takes a budget and keeps the
 *    head and the tail, because on a call that is being analysed for intent,
 *    how it opened matters as much as what was just said.
 * 2. Re-analysing an unchanged transcript costs money and returns the same
 *    answer. `pendingSegments` exists so the caller can skip a tick.
 */

export type Segment = {
  speaker: string;
  text: string;
  /** Milliseconds since the transcript opened. */
  at: number;
};

export type RenderOptions = {
  /**
   * Rough character budget for the rendered transcript. When the conversation
   * outgrows it, the middle is dropped rather than the beginning.
   */
  maxChars?: number;
};

const ELISION = "\n[... earlier conversation trimmed ...]\n";

export class RollingTranscript {
  private readonly segments: Segment[] = [];
  private readonly open = new Map<string, string>();
  private analyzedThrough = 0;
  private readonly startedAt: number;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  /** Partial text while the speaker is still going. Replaces, never appends —
   *  most engines resend the whole in-progress turn on each delta. */
  delta(speaker: string, text: string): void {
    this.open.set(speaker, text);
  }

  /** The turn closed. This is the only thing that reaches the transcript. */
  final(speaker: string, text: string): void {
    this.open.delete(speaker);
    const trimmed = text.trim();
    if (!trimmed) return;
    this.segments.push({ speaker, text: trimmed, at: this.now() - this.startedAt });
  }

  /** Final segments that have arrived since the last markAnalyzed(). */
  get pendingSegments(): number {
    return this.segments.length - this.analyzedThrough;
  }

  get segmentCount(): number {
    return this.segments.length;
  }

  /** What is being said right now, per speaker. Useful for a live caption line,
   *  deliberately excluded from what the model sees. */
  get inFlight(): ReadonlyMap<string, string> {
    return this.open;
  }

  markAnalyzed(): void {
    this.analyzedThrough = this.segments.length;
  }

  /** Only the turns the model has not seen yet, for a prompt that asks "what
   *  changed" rather than re-sending everything. */
  renderPending(): string {
    return this.format(this.segments.slice(this.analyzedThrough));
  }

  render({ maxChars }: RenderOptions = {}): string {
    const full = this.format(this.segments);
    if (!maxChars || full.length <= maxChars) return full;

    // Keep the opening — on a call being judged for intent, the first minute
    // carries the pretext — and the most recent exchange. Drop the middle.
    const headBudget = Math.floor(maxChars * 0.3);
    const tailBudget = maxChars - headBudget - ELISION.length;

    const head = full.slice(0, headBudget);
    const tail = full.slice(full.length - tailBudget);

    // Do not slice mid-line; it produces half-attributed quotes that the model
    // will then cite as evidence.
    return (
      head.slice(0, head.lastIndexOf("\n") + 1 || head.length) +
      ELISION +
      tail.slice(tail.indexOf("\n") + 1)
    );
  }

  private format(segments: readonly Segment[]): string {
    return segments.map((s) => `${formatClock(s.at)} ${s.speaker}: ${s.text}`).join("\n");
  }
}

/** mm:ss — the model reasons better about pacing when turns are timestamped,
 *  and it lets a finding point at a moment in the call. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}
