/**
 * POSTs batched TranscriptSegments to the gateway's browser-ingest route and
 * retries a failed batch with backoff — WITHOUT ever changing a segment's
 * `providerEventKey`, because the gateway dedups forever on that key
 * (server/src/session.ts, shared/src/transcript-source.ts) and a retry that
 * minted a new key would double-append the same words into the transcript.
 * A failed batch is spliced back onto the front of the queue, same object
 * references, so a retry is byte-for-byte the same POST body.
 *
 * Endpoint contract this app targets (not yet implemented server-side — see
 * README.md "What the next agent needs to build"):
 *
 *   POST {gatewayUrl}/session/{sessionId}/segments
 *   Authorization: Bearer {sessionToken}   (sent only when session-client.ts
 *                                           actually receives one)
 *   Content-Type: application/json
 *   Body: { "segments": TranscriptSegment[] }
 *   -> 202 { "accepted": number }
 *
 * Batching is time-based, not size-based: everything queued in the last
 * `flushMs` goes out in one request. That is "batch sensibly" for a live
 * two-person demo call, where segment volume is a handful per second at most.
 */
import type { TranscriptSegment } from "../../../shared/src/index.ts";

export type PostStats = {
  posted: number;
  failedAttempts: number;
  pending: number;
  lastError?: string;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export class TranscriptPoster {
  private readonly queue: TranscriptSegment[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private inFlight = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private stopped = false;

  private readonly stats: PostStats = { posted: 0, failedAttempts: 0, pending: 0 };

  constructor(
    private readonly gatewayUrl: string,
    private readonly sessionId: string,
    private readonly token: string | undefined,
    private readonly onStats: (stats: Readonly<PostStats>) => void,
    flushMs = 300,
  ) {
    this.timer = setInterval(() => void this.flush(), flushMs);
  }

  enqueue(segment: TranscriptSegment): void {
    this.queue.push(segment);
    this.publishStats();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  private publishStats(): void {
    this.stats.pending = this.queue.length + (this.inFlight ? 1 : 0);
    this.onStats({ ...this.stats });
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.inFlight || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, this.queue.length);
    this.publishStats();

    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.token) headers.authorization = `Bearer ${this.token}`;

      const res = await fetch(`${this.gatewayUrl}/session/${this.sessionId}/segments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ segments: batch }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }

      this.stats.posted += batch.length;
      this.backoffMs = INITIAL_BACKOFF_MS;
    } catch (cause) {
      this.stats.failedAttempts += 1;
      this.stats.lastError = cause instanceof Error ? cause.message : String(cause);
      // Same objects, same providerEventKey — see file header.
      this.queue.unshift(...batch);
      const wait = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      await sleep(wait);
    } finally {
      this.inFlight = false;
      this.publishStats();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
