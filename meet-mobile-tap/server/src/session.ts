/**
 * One monitored call, start to finish.
 *
 * The state machine is a table, not a pile of ifs: `idle -> awaiting-consent
 * -> running -> ending -> ended`, no re-entry. An illegal request (start an
 * already-running session, grant consent twice, end an idle one) never
 * throws at the caller — it is rejected with an `error` SessionEvent and the
 * state does not move. That is what lets the gateway hand a raw, possibly
 * malformed `ClientMessage` straight to a Session method without a try/catch
 * around every dispatch.
 *
 * Consent is a gate in this state machine, not a check a caller has to
 * remember to make: `handleSegment` drops everything on the floor unless
 * `state === "running"`. Nothing pre-consent ever reaches RollingTranscript,
 * by construction — see the "put the gate in the state machine" instruction
 * this was built against.
 *
 * Ordering: TranscriptSource segments are the provider's problem to garble —
 * Twilio POSTs them out of order and sometimes twice (see
 * shared/src/transcript-source.ts). `providerEventKey` is deduped forever;
 * `sequence` is resolved with a short reorder buffer flushed on the next
 * event-loop turn (`setImmediate`), which is long enough to absorb a burst of
 * near-simultaneous, out-of-order POSTs and short enough that it is never the
 * reason a live transcript feels laggy.
 */
import { randomUUID } from "node:crypto";
import { RollingTranscript } from "../../agent/src/transcript.ts";
import { ProgressiveAnalyzer, type AnalyzerOptions, type PassMeta } from "../../agent/src/analyzer.ts";
import type { RiskProfile } from "../../agent/src/risk-profile.ts";
import type {
  Speaker,
  SessionEvent,
  SessionState,
  TranscriptSegment,
  TranscriptSource,
  TranscriptSourceKind,
  TranscriptSourceStopReason,
  Unsubscribe,
} from "../../shared/src/index.ts";

/** Everything ProgressiveAnalyzer needs except the transcript it will be
 *  bound to and the callbacks Session itself supplies — reusing the analyzer's
 *  own option shape means this file never redeclares what a model client is. */
export type SessionAnalyzerOptions = Omit<AnalyzerOptions, "transcript" | "onResult" | "onError">;

/** Plain `Omit` over a union collapses to the members' common keys (`type`
 *  only, here) instead of omitting per-branch — this distributes over the
 *  union first so each variant keeps its own extra fields minus the envelope
 *  ones `emit()` stamps on every call. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<SessionEvent, "sessionId" | "seq" | "atMs">;

export type SessionOptions = {
  id?: string;
  transportKind: TranscriptSourceKind;
  transcriptSource: TranscriptSource;
  analyzer: SessionAnalyzerOptions;
  /** Every emitted event, stamped and in order. The registry is what fans
   *  this out to subscribers and keeps the replay log — Session only knows
   *  how to produce a correctly-sequenced stream. */
  onEvent: (event: SessionEvent) => void;
  /** Session clock. Defaults to Date.now; tests supply a controlled one so
   *  atMs assertions are not wall-clock. */
  now?: () => number;
};

/** idle only ever moves forward; ended never moves anywhere. Encoding the
 *  whole machine as a lookup table is what makes "no re-entry" true by
 *  construction rather than by every call site remembering to check. */
const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle: ["awaiting-consent"],
  "awaiting-consent": ["running", "ended"],
  running: ["ending"],
  ending: ["ended"],
  ended: [],
};

export class Session {
  readonly id: string;
  readonly transportKind: TranscriptSourceKind;

  private readonly source: TranscriptSource;
  private readonly transcript: RollingTranscript;
  private readonly analyzer: ProgressiveAnalyzer;
  private readonly analyzerAbort = new AbortController();
  private readonly onEvent: (event: SessionEvent) => void;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly unsubscribers: Unsubscribe[] = [];

  private stateValue: SessionState = "idle";
  private seq = 0;
  private endingInFlight = false;

  private readonly speakers = new Map<string, Speaker>();

  // Dedup is forever (a Twilio retry can arrive long after its burst).
  // Reordering is only ever within one burst — see `flushPending`.
  private readonly seenEventKeys = new Set<string>();
  private readonly pending = new Map<string, TranscriptSegment>();
  private flushHandle: NodeJS.Immediate | undefined;

  private discardedSegments = 0;

  constructor(options: SessionOptions) {
    this.id = options.id ?? randomUUID();
    this.transportKind = options.transportKind;
    this.source = options.transcriptSource;
    this.onEvent = options.onEvent;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();

    // Same clock, same epoch: RollingTranscript's own `startedAt` is set on
    // the next line, synchronously, so `this.now() - this.startedAt` here and
    // `at` inside the transcript agree on what "t=0" means.
    this.transcript = new RollingTranscript(this.now);

    this.analyzer = new ProgressiveAnalyzer({
      ...options.analyzer,
      signal: options.analyzer.signal
        ? AbortSignal.any([options.analyzer.signal, this.analyzerAbort.signal])
        : this.analyzerAbort.signal,
      transcript: this.transcript,
      onResult: (profile, meta) => this.handleRiskUpdate(profile, meta),
      onError: (error) => this.emitError(error.message),
    });

    this.unsubscribers.push(
      this.source.onSegment((segment) => this.handleSegment(segment)),
      this.source.onSpeaker((speaker) => this.handleSpeaker(speaker)),
      this.source.onEnded((reason) => this.handleTransportEnded(reason)),
    );
  }

  get state(): SessionState {
    return this.stateValue;
  }

  /** Final turns actually written to the transcript — what the consent gate
   *  and the dedup/reorder logic are tested against. */
  get segmentCount(): number {
    return this.transcript.segmentCount;
  }

  /** Segments the consent gate has thrown away. Only ever non-zero before
   *  consent is granted or after the session has ended. */
  get discardedSegmentCount(): number {
    return this.discardedSegments;
  }

  get latestProfile(): RiskProfile | undefined {
    return this.analyzer.lastProfile;
  }

  renderTranscript(): string {
    return this.transcript.render();
  }

  // ---- client-facing state transitions -----------------------------------

  /** idle -> awaiting-consent. Starts the transcript source; the analyzer
   *  does not start until consent is granted — there is nothing to analyse
   *  before then, and no point ticking a timer for it.
   *
   *  The exception is `replay`, which is deferred to `grantConsent()`. A real
   *  call is already happening whether or not anyone has answered the consent
   *  prompt, so starting twilio/livekit here and letting the gate throw the
   *  segments away is the honest thing to do. A scripted fixture has no such
   *  clock: started here, it plays to a closed gate while the person reads the
   *  prompt, and a reader who takes ten seconds gets an empty call. */
  start(): void {
    if (!this.moveTo("awaiting-consent")) return;
    if (this.source.kind === "replay") return;
    void this.source.start({ sessionId: this.id, startedAt: this.startedAt });
  }

  /** awaiting-consent -> running. */
  grantConsent(): void {
    if (!this.moveTo("running")) return;
    // Deferred above, so the script starts from its first line, not its middle.
    if (this.source.kind === "replay") {
      void this.source.start({ sessionId: this.id, startedAt: this.startedAt });
    }
    this.analyzer.start();
  }

  /** awaiting-consent -> ended, directly — no `ending` pass, because nothing
   *  was ever admitted into the transcript to flush. */
  declineConsent(): void {
    if (this.stateValue !== "awaiting-consent") {
      this.rejectTransition("ended");
      return;
    }
    this.finish("consent-declined");
  }

  /** running (or a call ended while still awaiting consent) -> ended, via
   *  `ending` when there is a transcript worth flushing. */
  end(): void {
    if (this.stateValue !== "running" && this.stateValue !== "awaiting-consent") {
      this.rejectTransition("ending");
      return;
    }
    this.finish("call-ended");
  }

  /** Immediate gateway-shutdown cleanup. This never starts or waits for a
   * final model pass, but it does cancel a pass already in flight. */
  async abort(reason: TranscriptSourceStopReason = "replaced"): Promise<void> {
    if (this.stateValue === "ended") return;
    if (this.flushHandle) clearImmediate(this.flushHandle);
    this.flushHandle = undefined;
    this.pending.clear();
    this.analyzer.stop();
    this.analyzerAbort.abort();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.stateValue = "ended";
    this.endingInFlight = false;
    await this.source.stop(reason);
  }

  // ---- transport-driven ---------------------------------------------------

  private handleTransportEnded(reason: TranscriptSourceStopReason): void {
    if (this.stateValue === "idle" || this.stateValue === "ended") return;
    this.finish(reason);
  }

  private handleSpeaker(speaker: Speaker): void {
    this.speakers.set(speaker.id, speaker);
  }

  /** The consent gate. This is the only place a segment can enter the
   *  transcript, so there is exactly one place to check consent. */
  private handleSegment(segment: TranscriptSegment): void {
    if (this.stateValue !== "running") {
      this.discardedSegments += 1;
      return;
    }
    if (this.seenEventKeys.has(segment.providerEventKey)) return;
    if (this.pending.has(segment.providerEventKey)) return;

    this.pending.set(segment.providerEventKey, segment);
    this.flushHandle ??= setImmediate(() => this.flushPending());
  }

  /** Resolves one burst of (possibly out-of-order, never-yet-deduped)
   *  segments by sequence, then applies them in that order. A burst is
   *  whatever arrived since the last flush — one event-loop turn. */
  private flushPending(): void {
    this.flushHandle = undefined;
    const ready = [...this.pending.values()].sort((a, b) => a.sequence - b.sequence);
    this.pending.clear();
    for (const segment of ready) {
      this.seenEventKeys.add(segment.providerEventKey);
      this.applySegment(segment);
    }
  }

  private applySegment(segment: TranscriptSegment): void {
    const speaker = this.speakers.get(segment.speakerId);
    const label = speaker?.label ?? segment.speakerId;
    const role = speaker?.role ?? segment.role;

    if (!segment.isFinal) {
      this.transcript.delta(segment.speakerId, segment.text);
      return;
    }

    this.transcript.final(segment.speakerId, segment.text);
    // Mirrors RollingTranscript's own rule: this event exists only for
    // finals, so a client never renders text the transcript would discard.
    this.emit({
      type: "transcript.turn",
      speakerId: segment.speakerId,
      speakerLabel: label,
      role,
      text: segment.text,
    });
  }

  private handleRiskUpdate(profile: RiskProfile, meta: PassMeta): void {
    if (this.analyzerAbort.signal.aborted) return;
    this.emit({ type: "risk.updated", profile, pass: meta.pass, latencyMs: meta.latencyMs });
  }

  // ---- shutdown ------------------------------------------------------------

  /** The one path to `ended`, however it was reached: an explicit
   *  session.end, a declined consent, or the transport reporting the call is
   *  over. Two shapes, both ending in the same cleanup:
   *
   *  - `running -> ending -> ended`: there is a transcript worth flushing,
   *    so `ending` is a real, observable, awaited state — a subscriber sees
   *    it and knows a final pass is in flight.
   *  - `awaiting-consent -> ended`: nothing was ever admitted past the
   *    consent gate, so there is nothing to flush and no reason to make a
   *    client wait through an intermediate state for it — this resolves
   *    synchronously, matching `start()`/`grantConsent()`'s own synchronous
   *    transitions. */
  private finish(reason: TranscriptSourceStopReason): void {
    if (this.endingInFlight || this.stateValue === "ended") return;

    if (this.stateValue === "running") {
      this.endingInFlight = true;
      this.moveTo("ending");
      void this.flushThenEnd(reason);
      return;
    }

    this.moveTo("ended");
    this.cleanup(reason);
  }

  private async flushThenEnd(reason: TranscriptSourceStopReason): Promise<void> {
    try {
      // A burst mid-flight when the call ends should still land before the
      // final analysis pass, not be dropped on the floor by a pending timer.
      if (this.flushHandle) {
        clearImmediate(this.flushHandle);
        this.flushPending();
      }
      await this.analyzer.flush();
      if (this.analyzerAbort.signal.aborted) return;
      this.cleanup(reason);
      this.moveTo("ended");
    } finally {
      this.endingInFlight = false;
    }
  }

  private cleanup(reason: TranscriptSourceStopReason): void {
    this.analyzer.stop();
    void this.source.stop(reason);
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  // ---- state machine plumbing ----------------------------------------------

  private moveTo(next: SessionState): boolean {
    if (!TRANSITIONS[this.stateValue].includes(next)) {
      this.rejectTransition(next);
      return false;
    }
    this.stateValue = next;
    this.emit({ type: "session.state", state: next, transport: this.transportKind });
    return true;
  }

  private rejectTransition(attempted: SessionState): void {
    this.emitError(`cannot move session from "${this.stateValue}" to "${attempted}"`);
  }

  private emitError(message: string): void {
    if (this.analyzerAbort.signal.aborted) return;
    this.emit({ type: "error", message });
  }

  private emit(event: EventInput): void {
    this.seq += 1;
    this.onEvent({
      ...event,
      sessionId: this.id,
      seq: this.seq,
      atMs: this.now() - this.startedAt,
    } as SessionEvent);
  }
}
