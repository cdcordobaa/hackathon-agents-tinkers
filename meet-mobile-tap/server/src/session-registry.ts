/**
 * Sessions by opaque id. This is bookkeeping only — Session already stops its
 * own analyzer and transcript source on the way to `ended` (see
 * session.ts#finish); the registry's job is to stop remembering the session
 * so a late reconnect gets an honest "not found" instead of replaying a call
 * that is over. That is a literal reading of the call-session spec's own
 * scenario: "its entry is removed from the registry."
 */
import { randomUUID } from "node:crypto";
import { Session, type SessionAnalyzerOptions } from "./session.ts";
import type { SessionEvent, TranscriptSource, TranscriptSourceKind, Unsubscribe } from "../../shared/src/index.ts";

export type SessionRegistryOptions = {
  createTranscriptSource: (kind: TranscriptSourceKind) => TranscriptSource;
  analyzer: SessionAnalyzerOptions;
  defaultTransportKind?: TranscriptSourceKind;
  idFactory?: () => string;
};

type SessionRecord = {
  session: Session;
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

    this.records.set(id, { session, events, subscribers });
    return session;
  }

  get(id: string): Session | undefined {
    return this.records.get(id)?.session;
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
