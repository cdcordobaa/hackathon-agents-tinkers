/**
 * Which model provider to analyse with.
 *
 * Gemini publishes an OpenAI-compatible endpoint, so the whole switch is a
 * baseURL and a model name — the analyzer code is identical either way.
 *
 * Two places where the compatibility shim is not a pixel-perfect clone, both
 * handled here:
 *
 * - `strict: true` on a json_schema is an OpenAI extension. Gemini's shim does
 *   not honour it, and sending it is a coin flip between ignored and rejected.
 *   `supportsStrictSchema` is what the analyzer keys off.
 * - The free tier is rate-limited hard (single-digit requests per minute), which
 *   is low enough to change the analyzer's default interval rather than just
 *   being a footnote. See `suggestedIntervalMs`.
 *
 * A Claude subscription cannot be used here. Pro/Max covers the Claude apps and
 * Claude Code, not API calls from your own process; the Anthropic API is billed
 * separately with a key from console.anthropic.com.
 */
import OpenAI from "openai";

export type Provider = "openai" | "gemini";

export type ModelSetup = {
  provider: Provider;
  client: OpenAI;
  model: string;
  supportsStrictSchema: boolean;
  /** Safe analysis cadence for this provider's default quota. */
  suggestedIntervalMs: number;
};

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/**
 * Gemini free tier allows only single-digit requests per minute on some models.
 * A 6s cadence is 10 rpm and will spend the whole call being throttled, so the
 * Gemini default is 15s. The skip-if-nothing-new rule in the analyzer does the
 * rest of the work.
 */
const GEMINI_INTERVAL_MS = 15_000;
const OPENAI_INTERVAL_MS = 6_000;

export function resolveModelSetup(env: NodeJS.ProcessEnv = process.env): ModelSetup {
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  // An explicit provider wins; otherwise whichever key is present, preferring
  // OpenAI when both are set so an existing setup does not silently change.
  const requested = env.ANALYSIS_PROVIDER as Provider | undefined;
  const provider: Provider =
    requested ?? (openaiKey ? "openai" : geminiKey ? "gemini" : "openai");

  if (provider === "gemini") {
    if (!geminiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Get a free key from https://aistudio.google.com/apikey",
      );
    }
    return {
      provider,
      client: new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL }),
      // 2.5-flash is the conservative pick: confirmed present and on the free
      // tier. Newer 3.x Flash ids exist — set ANALYSIS_MODEL to use one.
      model: env.ANALYSIS_MODEL ?? "gemini-2.5-flash",
      supportsStrictSchema: false,
      suggestedIntervalMs: Number(env.ANALYSIS_INTERVAL_MS) || GEMINI_INTERVAL_MS,
    };
  }

  if (!openaiKey) {
    throw new Error(
      "No model key found. Set OPENAI_API_KEY, or GEMINI_API_KEY for the free Gemini tier.",
    );
  }

  return {
    provider,
    client: new OpenAI({ apiKey: openaiKey }),
    model: env.ANALYSIS_MODEL ?? "gpt-5-mini",
    supportsStrictSchema: true,
    suggestedIntervalMs: Number(env.ANALYSIS_INTERVAL_MS) || OPENAI_INTERVAL_MS,
  };
}
