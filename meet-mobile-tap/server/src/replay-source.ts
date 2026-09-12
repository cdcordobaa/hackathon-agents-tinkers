/**
 * `TranscriptSource` over the scripted bank-scam call. No network, no phone,
 * no Twilio account — this is the rung the task description calls "always
 * works", and it is also what `npm run dev` defaults to so the gateway is
 * demoable with zero external config.
 *
 * Deliberately well-behaved: turns arrive in order with unique keys, once
 * each. That is a feature, not an oversight — shared/README.md is explicit
 * that the well-behaved replay fixture is not what exercises Session's
 * dedup/reorder logic, and building a second, deliberately hostile fake was
 * called out there as separate, unstarted work.
 */
import { BANK_SCAM, type ScriptedTurn } from "../../agent/src/fixtures/bank-scam.ts";
import type {
  Speaker,
  SpeakerRole,
  TranscriptSegment,
  TranscriptSource,
  TranscriptSourceStartContext,
  TranscriptSourceStopReason,
  Unsubscribe,
} from "../../shared/src/index.ts";

const roleFor = (speaker: string): SpeakerRole => (speaker === "you" ? "subject" : "counterparty");
const labelFor = (speaker: string): string => (speaker === "you" ? "You" : "Caller");

export class ReplaySource implements TranscriptSource {
  readonly kind = "replay" as const;

  private readonly turns: readonly ScriptedTurn[];
  private readonly speed: number;
  private readonly now: () => number;

  private readonly segmentCbs = new Set<(segment: TranscriptSegment) => void>();
  private readonly speakerCbs = new Set<(speaker: Speaker) => void>();
  private readonly endedCbs = new Set<(reason: TranscriptSourceStopReason) => void>();

  private timers: ReturnType<typeof setTimeout>[] = [];
  private announced = new Set<string>();
  private sequence = 0;
  private running = false;
  private startedAt = 0;

  constructor(turns: readonly ScriptedTurn[] = BANK_SCAM, speed = 1, now: () => number = Date.now) {
    this.turns = turns;
    this.speed = speed;
    this.now = now;
  }

  start(ctx: TranscriptSourceStartContext): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = ctx.startedAt;

    let elapsed = 0;
    for (const turn of this.turns) {
      elapsed += turn.gapMs / this.speed;
      this.timers.push(setTimeout(() => this.emitTurn(turn), Math.round(elapsed)));
    }
    // A beat after the last line, the call is simply over — nobody hangs up.
    this.timers.push(
      setTimeout(() => this.finish("call-ended"), Math.round(elapsed) + 50),
    );
  }

  stop(reason: TranscriptSourceStopReason): void {
    if (!this.running) return;
    this.finish(reason);
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

  private emitTurn(turn: ScriptedTurn): void {
    if (!this.running) return;

    if (!this.announced.has(turn.speaker)) {
      this.announced.add(turn.speaker);
      const speaker: Speaker = { id: turn.speaker, label: labelFor(turn.speaker), role: roleFor(turn.speaker) };
      for (const cb of this.speakerCbs) cb(speaker);
    }

    const sequence = this.sequence++;
    const segment: TranscriptSegment = {
      speakerId: turn.speaker,
      role: roleFor(turn.speaker),
      text: turn.text,
      isFinal: true,
      sequence,
      providerEventKey: `replay:${sequence}`,
      atMs: this.now() - this.startedAt,
    };
    for (const cb of this.segmentCbs) cb(segment);
  }

  private finish(reason: TranscriptSourceStopReason): void {
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers.splice(0)) clearTimeout(timer);
    for (const cb of this.endedCbs) cb(reason);
  }
}
