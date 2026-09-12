/**
 * Progressive analysis: every few seconds, hand the growing transcript to the
 * model and get a revised profile back.
 *
 * Three rules keep this from falling over on a long call:
 *
 *   skip if nothing new    — re-analysing an unchanged transcript costs money
 *                            and returns the same answer.
 *   never overlap          — passes take seconds; if one is still running the
 *                            tick is dropped, not queued. A queue on a fixed
 *                            interval only ever grows.
 *   bound the prompt       — RollingTranscript.render({ maxChars }) keeps the
 *                            head and tail. Unbounded concatenation is fine for
 *                            ten minutes and fatal for an hour.
 *
 * The stable system prompt goes first in the message list on purpose: the
 * growing transcript then sits behind a constant prefix, which is what prompt
 * caching can actually reuse between passes.
 */
import OpenAI from "openai";
import { isRiskProfile } from "../../shared/session.ts";
import { RollingTranscript } from "./transcript.ts";
import {
  RISK_PROFILE_SCHEMA,
  SYSTEM_PROMPT,
  renderPrevious,
  type RiskProfile,
} from "./risk-profile.ts";

export type AnalyzerOptions = {
  transcript: RollingTranscript;
  client: OpenAI;
  /** Set ANALYSIS_MODEL to whatever your account actually has. */
  model?: string;
  /** `strict` on a json_schema is an OpenAI extension; Gemini's compatibility
   *  endpoint does not honour it. Defaults to true. */
  supportsStrictSchema?: boolean;
  /** How often to consider a pass. Default 6s — fast enough to feel live,
   *  slow enough that turns complete between passes. */
  intervalMs?: number;
  /** Minimum new final turns before a pass is worth making. */
  minNewSegments?: number;
  /** Prompt budget for the transcript itself. */
  maxTranscriptChars?: number;
  /** Bound every model request so end-of-call shutdown cannot wait forever. */
  requestTimeoutMs?: number;
  /** Cancels model work when the owning call is torn down. */
  signal?: AbortSignal;
  onResult: (profile: RiskProfile, meta: PassMeta) => void;
  onError?: (error: Error) => void;
};

export type PassMeta = {
  pass: number;
  segments: number;
  latencyMs: number;
  skipped?: "no-new-speech" | "still-running";
};

export class ProgressiveAnalyzer {
  private timer?: ReturnType<typeof setInterval>;
  private activePass?: Promise<void>;
  private passes = 0;
  private previous?: RiskProfile;

  private readonly model: string;
  private readonly intervalMs: number;
  private readonly minNewSegments: number;
  private readonly maxTranscriptChars: number;
  private readonly supportsStrictSchema: boolean;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: AnalyzerOptions) {
    this.model = options.model ?? process.env.ANALYSIS_MODEL ?? "gpt-5-mini";
    this.supportsStrictSchema = options.supportsStrictSchema ?? true;
    this.intervalMs = options.intervalMs ?? 6_000;
    this.minNewSegments = options.minNewSegments ?? 1;
    this.maxTranscriptChars = options.maxTranscriptChars ?? 12_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Force a pass regardless of the interval — used at end of call so the last
   *  few turns are not dropped on the floor. */
  async flush(): Promise<void> {
    // An interval tick is disposable, but an end-of-call flush is not. If a
    // pass is already running, let it settle and then claim the final state of
    // the transcript in a fresh pass.
    while (this.activePass) await this.activePass;
    await this.tick({ force: true });
  }

  get lastProfile(): RiskProfile | undefined {
    return this.previous;
  }

  private async tick({ force = false } = {}): Promise<void> {
    if (this.activePass) return;

    const pass = this.runPass(force);
    if (!pass) return;

    this.activePass = pass;
    try {
      await pass;
    } finally {
      if (this.activePass === pass) this.activePass = undefined;
    }
  }

  private runPass(force: boolean): Promise<void> | undefined {
    const { transcript, onResult, onError } = this.options;

    if (!force && transcript.pendingSegments < this.minNewSegments) return undefined;
    if (transcript.segmentCount === 0) return undefined;

    const startedAt = Date.now();
    const segments = transcript.segmentCount;

    // Claim the turns now. If the pass throws, they are not re-queued — the
    // next pass sends the whole transcript anyway, so nothing is actually lost.
    transcript.markAnalyzed();

    return (async () => {
      try {
        const profile = await this.analyze(
          transcript.render({ maxChars: this.maxTranscriptChars }),
        );
        this.previous = profile;
        this.passes += 1;
        onResult(profile, {
          pass: this.passes,
          segments,
          latencyMs: Date.now() - startedAt,
        });
      } catch (cause) {
        onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();
  }

  private async analyze(transcriptText: string): Promise<RiskProfile> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, timeout])
      : timeout;
    const response = await this.options.client.chat.completions.create({
      model: this.model,
      messages: [
        // Constant prefix first — this is the part prompt caching can reuse.
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            renderPrevious(this.previous),
            "",
            "Call transcript so far:",
            transcriptText,
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "risk_profile",
          // Omitted for Gemini — its OpenAI shim does not implement `strict`,
          // and sending it is a coin flip between ignored and rejected.
          ...(this.supportsStrictSchema ? { strict: true as const } : {}),
          schema: RISK_PROFILE_SCHEMA,
        },
      },
    }, { signal });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("The model returned no content.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The model returned invalid JSON.");
    }
    if (!isRiskProfile(parsed)) {
      throw new Error("The model returned an invalid risk profile.");
    }
    return parsed;
  }
}
