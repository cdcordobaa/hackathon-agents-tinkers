/**
 * Sessions by opaque id. This is bookkeeping only — Session already stops its
 * own analyzer and transcript source on the way to `ended` (see
 * session.ts#finish); the registry's job is to stop remembering the session
 * so a late reconnect gets an honest "not found" instead of replaying a call
 * that is over. That is a literal reading of the call-session spec's own
 * scenario: "its entry is removed from the registry."
 *
 * Also mints and checks the per-session browser-ingest credential
 * (add-browser-livekit-rung's "Segment ingestion is bound to an authorised
 * session" requirement) and keeps a handle on each session's own
 * `TranscriptSource` — the gateway's segments route needs both to push a
 * POSTed segment into the one session it is authorised for, and neither
 * belongs on `Session` itself, which does not know or care where its source
 * came from.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Session, type SessionAnalyzerOptions } from "./session.ts";
import type { SessionEvent, TranscriptSource, TranscriptSourceKind, Unsubscribe } from "../../shared/src/index.ts";

/** Constant-time compare so a mismatched ingest token fails in time
 *  independent of how many leading characters happened to match — a
 *  prototype-grade secret per the task, but a free hardening at this size. */
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type SessionRegistryOptions = {
  createTranscriptSource: (kind: TranscriptSourceKind) => TranscriptSource;
  analyzer: SessionAnalyzerOptions;
  defaultTransportKind?: TranscriptSourceKind;
  idFactory?: () => string;
};

type SessionRecord = {
  session: Session;
  source: TranscriptSource;
  /** Minted once at creation, never rotated in this scope. Whoever holds it
   *  may POST segments into exactly this session — see `verifyIngestToken`. */
  ingestToken: string;
  events: SessionEvent[];
  subscribers: Set<(event: SessionEvent) => void>;
};

export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>();
  private readonly defaultTransportKind: TranscriptSourceKind;

  constructor(private readonly options: SessionRegistryOptions) {
    this.defaultTransportKind = options.defaultTransportKind ?? "replay";
  }

  create(transportKind: TranscriptSourceKind = this.defaultTransportKind): Session {
    const id = (this.options.idFactory ?? randomUUID)();
    const ingestToken = randomUUID();
    const events: SessionEvent[] = [];
    const subscribers = new Set<(event: SessionEvent) => void>();

    const source = this.options.createTranscriptSource(transportKind);
    const session = new Session({
      id,
      transportKind,
      transcriptSource: source,
      analyzer: this.options.analyzer,
      onEvent: (event) => {
        events.push(event);
        for (const subscriber of subscribers) subscriber(event);
        // Once `ended` is on the wire to everyone currently listening, there
        // is nothing left for a late subscriber to usefully catch up on.
        if (event.type === "session.state" && event.state === "ended") {
          this.records.delete(id);
        }
      },
    });

    this.records.set(id, { session, source, ingestToken, events, subscribers });
    return session;
  }

  get(id: string): Session | undefined {
    return this.records.get(id)?.session;
  }

  /** The `TranscriptSource` instance backing this session — what the
   *  segments route pushes an authorised, validated segment into. `undefined`
   *  for an unknown session, same convention as `get`. */
  getTranscriptSource(id: string): TranscriptSource | undefined {
    return this.records.get(id)?.source;
  }

  /** `undefined` only for an unknown session id — used by the `POST /session`
   *  handler to hand the token back to the caller that just created it. */
  getIngestToken(id: string): string | undefined {
    return this.records.get(id)?.ingestToken;
  }

  /**
   * Binds a caller to exactly the session it was issued a credential for.
   * `false` for a missing token, an unknown session, AND a token that
   * belongs to a different session — the three cases the segment-ingestion
   * spec requires to be indistinguishable from each other in outcome (each
   * refuses, none reveals which reason), even though the gateway route
   * chooses one HTTP status for all three so as not to leak which case it
   * hit.
   */
  verifyIngestToken(id: string, token: string | undefined): boolean {
    if (!token) return false;
    const record = this.records.get(id);
    if (!record) return false;
    return tokensMatch(record.ingestToken, token);
  }

  /** Events with seq strictly greater than `sinceSeq` — undefined means the
   *  session id is unknown (never existed, or already ended and released). */
  eventsSince(id: string, sinceSeq = 0): SessionEvent[] | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    return record.events.filter((event) => event.seq > sinceSeq);
  }

  subscribe(id: string, listener: (event: SessionEvent) => void): Unsubscribe | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    record.subscribers.add(listener);
    return () => record.subscribers.delete(listener);
  }

  get size(): number {
    return this.records.size;
  }
}
