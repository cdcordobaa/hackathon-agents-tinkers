/**
 * `TranscriptSource` fed by HTTP POSTs from the browser rung (`web/`), not by
 * a timer (`ReplaySource`) or a provider callback (Twilio, elsewhere). A
 * segment arrives PUSHED — see `ingest()` — from a route that has already
 * cleared the trust boundary (auth, shape, rate limit) before this class
 * ever sees it. This class knows nothing about HTTP, tokens, or validation:
 * it only re-emits what it is handed through the same
 * onSegment/onSpeaker/onEnded seam every other `TranscriptSource` uses, so
 * `Session` cannot tell this apart from `ReplaySource` — the dedup-by-key
 * and reorder-by-sequence logic already lives in `Session`
 * (server/src/session.ts), and stays there; duplicating it here would be
 * exactly the special-casing the task this was built against ruled out.
 *
 * `kind` is `"livekit"`, not a new `"browser"` value — `shared/src/transcript-
 * source.ts` already reserves `livekit` for exactly this ("has no transcript
 * source in this pass ... listed only so the union does not need to change
 * when it grows one"). This is that source growing in.
 *
 * Rate limiting lives HERE, one fixed window per instance, because one
 * instance exists per session — so "per session" falls out for free instead
 * of needing a second map keyed by session id at the route layer. A runaway
 * or malicious browser tab posting many small batches a second must not
 * turn into unbounded `ProgressiveAnalyzer` passes downstream (see
 * agent/src/analyzer.ts's own "never overlap" rule — that protects the
 * analyzer's *concurrency*, not the transcript's *growth rate*, which is
 * this file's job). `ingest()` returns whether a segment was accepted so the
 * route can report an honest `accepted` count in its 202 rather than a
 * silent drop that looks like success.
 */
import type {
  Speaker,
  SpeakerRole,
  TranscriptSegment,
  TranscriptSource,
  TranscriptSourceStartContext,
  TranscriptSourceStopReason,
  Unsubscribe,
} from "../../shared/src/index.ts";

export type BrowserTranscriptSourceOptions = {
  /** Segments accepted per `windowMs` before `ingest()` starts refusing.
   *  Generous for a two/three person demo call (a handful of finals a
   *  second at most, per web/README.md) and still a real bound on a
   *  runaway client. */
  maxSegmentsPerWindow?: number;
  windowMs?: number;
  now?: () => number;
};

const DEFAULT_MAX_SEGMENTS_PER_WINDOW = 60;
const DEFAULT_WINDOW_MS = 1000;

export class BrowserTranscriptSource implements TranscriptSource {
  readonly kind = "livekit" as const;

  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  private readonly segmentCbs = new Set<(segment: TranscriptSegment) => void>();
  private readonly speakerCbs = new Set<(speaker: Speaker) => void>();
  private readonly endedCbs = new Set<(reason: TranscriptSourceStopReason) => void>();

  private running = false;
  private windowStart = 0;
  private countInWindow = 0;

  /** Segments refused by the rate limiter since `start()`. Exposed for
   *  observability (a demo operator debugging "why did the HUD stall")
   *  rather than for any control-flow decision. */
  rateLimitedCount = 0;

  constructor(options: BrowserTranscriptSourceOptions = {}) {
    this.maxPerWindow = options.maxSegmentsPerWindow ?? DEFAULT_MAX_SEGMENTS_PER_WINDOW;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  start(_ctx: TranscriptSourceStartContext): void {
    if (this.running) return;
    this.running = true;
    this.windowStart = this.now();
    this.countInWindow = 0;
  }

  /** MUST be safe to call twice — matches every other TranscriptSource. */
  stop(reason: TranscriptSourceStopReason): void {
    if (!this.running) return;
    this.running = false;
    for (const cb of this.endedCbs) cb(reason);
  }

  onSegment(cb: (segment: TranscriptSegment) => void): Unsubscribe {
    this.segmentCbs.add(cb);
    return () => this.segmentCbs.delete(cb);
  }

  onSpeaker(cb: (speaker: Speaker) => void): Unsubscribe {
    this.speakerCbs.add(cb);
    return () => this.speakerCbs.delete(cb);
  }

  onEnded(cb: (reason: TranscriptSourceStopReason) => void): Unsubscribe {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  /**
   * Called by the ingest route once per already-validated segment (see
   * `parseSegment` below — the route never calls this with anything that
   * has not passed shape validation). Returns `false`, without emitting
   * anything, when the source is not running or this session's rate limit
   * has been hit for the current window.
   *
   * Emits `onSpeaker` are NOT synthesized here on purpose: unlike
   * `ReplaySource` (which knows a fixed "You"/"Caller" labelling the
   * segment itself doesn't carry), a browser segment already carries
   * `speakerId` and `role` directly, and `Session.applySegment` already
   * falls back to exactly those two fields when no `Speaker` was announced
   * for that id. Announcing one here would add a label no better than the
   * fallback and a second place to get role wrong.
   */
  ingest(segment: TranscriptSegment): boolean {
    if (!this.running) return false;
    if (!this.withinRateLimit()) {
      this.rateLimitedCount += 1;
      return false;
    }
    for (const cb of this.segmentCbs) cb(segment);
    return true;
  }

  private withinRateLimit(): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.countInWindow = 0;
    }
    if (this.countInWindow >= this.maxPerWindow) return false;
    this.countInWindow += 1;
    return true;
  }
}

// ---- untrusted-input validation --------------------------------------------
//
// A client-supplied segment is speech from a possible fraudster, POSTed by
// code the gateway does not control. It is DATA, never an instruction, at
// every boundary — this file is that boundary for shape, and does not look
// at `text` for anything except "is it a string within a sane length".

const ROLES: readonly SpeakerRole[] = ["subject", "counterparty", "unknown"];
const MAX_TEXT_LENGTH = 20_000; // generous for one finalized turn; not a transcript
const MAX_ID_LENGTH = 500;
/** A single POST batching more than this many segments is not "a live call's
 *  last flush interval" — it is either a bug or an attempt to force one huge
 *  analysis pass. Reject the whole request rather than silently truncating. */
export const MAX_SEGMENTS_PER_REQUEST = 200;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/** Structural validation only — never a semantic judgement about the speech
 *  itself. Returns `undefined` for anything that does not conform, so the
 *  caller can reject the whole request with a 4xx rather than pass a
 *  half-trusted object toward `Session`. */
export function parseSegment(input: unknown): TranscriptSegment | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = input as Record<string, unknown>;

  if (!isBoundedString(value.speakerId, MAX_ID_LENGTH)) return undefined;
  if (typeof value.role !== "string" || !ROLES.includes(value.role as SpeakerRole)) return undefined;
  if (typeof value.text !== "string" || value.text.length > MAX_TEXT_LENGTH) return undefined;
  if (typeof value.isFinal !== "boolean") return undefined;
  if (!isFiniteNumber(value.sequence)) return undefined;
  if (!isBoundedString(value.providerEventKey, MAX_ID_LENGTH)) return undefined;
  if (!isFiniteNumber(value.atMs)) return undefined;

  return {
    speakerId: value.speakerId,
    role: value.role as SpeakerRole,
    text: value.text,
    isFinal: value.isFinal,
    sequence: value.sequence,
    providerEventKey: value.providerEventKey,
    atMs: value.atMs,
  };
}

/** Validates the whole request body shape: `{ segments: TranscriptSegment[] }`
 *  with at least one entry and no more than `MAX_SEGMENTS_PER_REQUEST`.
 *  Returns `undefined` on any malformed input — the route treats that as a
 *  single reject-the-batch 400, matching "validate the payload shape before
 *  it reaches the session" rather than accepting whatever parses. */
export function parseSegmentBatch(body: unknown): TranscriptSegment[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const segments = (body as Record<string, unknown>).segments;
  if (!Array.isArray(segments) || segments.length === 0) return undefined;
  if (segments.length > MAX_SEGMENTS_PER_REQUEST) return undefined;

  const parsed: TranscriptSegment[] = [];
  for (const raw of segments) {
    const segment = parseSegment(raw);
    if (!segment) return undefined;
    parsed.push(segment);
  }
  return parsed;
}
