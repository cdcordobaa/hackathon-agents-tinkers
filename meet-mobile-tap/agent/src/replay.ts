/**
 * Replay harness — the whole progressive-analysis loop, with no phone, no
 * LiveKit room and no speech-to-text.
 *
 * It feeds a scripted call into the same RollingTranscript and the same
 * ProgressiveAnalyzer the live agent uses, so what you are testing here is the
 * real pipeline with only the audio source faked. That is deliberate: the
 * interesting behaviour — does the score move as the pretext develops, does it
 * spike at the OTP request — has nothing to do with microphones, and waiting on
 * a LiveKit account to find out would be a waste of the afternoon.
 *
 *   npm run replay                     # default fixture at 8x
 *   npm run replay -- --speed 1        # real time
 *   npm run replay -- --interval 4000  # analyse more often
 *
 * Needs only OPENAI_API_KEY.
 */
import { RollingTranscript } from "./transcript.ts";
import { ProgressiveAnalyzer } from "./analyzer.ts";
import { resolveModelSetup, type ModelSetup } from "./model-client.ts";
import { BANK_SCAM, type ScriptedTurn } from "./fixtures/bank-scam.ts";
import type { RiskProfile } from "./risk-profile.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  const raw = i !== -1 ? args[i + 1] : undefined;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

const speed = flag("speed", 8);

let setup: ModelSetup;
try {
  setup = resolveModelSetup();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  console.error("Put the key in agent/.env — npm run replay reads it.");
  process.exit(1);
}

// The provider's quota sets the floor for how often we can analyse, so it is
// the default rather than a fixed 6s. --interval still wins.
const requestedInterval = flag("interval", setup.suggestedIntervalMs);

// The interval is a cadence in CALL time, so replaying faster has to tighten it
// in wall time or the call ends before a single pass fires — at 8x a 35s call
// is over in 4s, and a 15s interval would show nothing but the final flush.
// Floored at 2s so a fast replay does not blow through the free-tier quota.
const intervalMs = Math.max(2000, Math.round(requestedInterval / speed));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const GREY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const LEVEL_COLOR: Record<RiskProfile["risk"], string> = {
  none: "\x1b[32m",
  low: "\x1b[32m",
  elevated: "\x1b[33m",
  high: "\x1b[31m",
};

function printProfile(profile: RiskProfile, pass: number, latencyMs: number): void {
  const color = LEVEL_COLOR[profile.risk] ?? "";
  const bar = "█".repeat(Math.round(profile.score / 5)).padEnd(20, "░");

  console.log("");
  console.log(
    `${GREY}── pass ${pass} · ${latencyMs}ms ${"─".repeat(40)}${RESET}`,
  );
  console.log(`${color}${bar}${RESET} ${BOLD}${profile.risk.toUpperCase()} ${profile.score}${RESET}`);
  console.log(`${BOLD}${profile.headline}${RESET}`);
  if (profile.advice) console.log(`→ ${profile.advice}`);
  if (profile.changed) console.log(`${GREY}changed: ${profile.changed}${RESET}`);
  for (const signal of profile.signals) {
    console.log(`  ${GREY}•${RESET} ${signal.type}  ${GREY}"${truncate(signal.quote, 70)}"${RESET}`);
  }
  console.log("");
}

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

async function main(): Promise<void> {
  const transcript = new RollingTranscript();
  const analyzer = new ProgressiveAnalyzer({
    transcript,
    client: setup.client,
    model: setup.model,
    supportsStrictSchema: setup.supportsStrictSchema,
    intervalMs,
    onResult: (profile, meta) => printProfile(profile, meta.pass, meta.latencyMs),
    onError: (error) => console.error(`${GREY}analysis failed:${RESET} ${error.message}`),
  });

  console.log(
    `${GREY}${setup.provider} · ${setup.model}${RESET}`,
  );
  console.log(
    `${GREY}Replaying ${BANK_SCAM.length} turns at ${speed}x · analysing every ${intervalMs}ms wall (${requestedInterval}ms call time)${RESET}`,
  );
  analyzer.start();

  for (const turn of BANK_SCAM as ScriptedTurn[]) {
    await sleep(turn.gapMs / speed);
    transcript.final(turn.speaker, turn.text);
    const who = turn.speaker === "you" ? "you " : "them";
    console.log(`${GREY}${who}${RESET}  ${turn.text}`);
  }

  analyzer.stop();
  // The last turns arrived after the final tick — the OTP request is usually
  // among them, so forcing one more pass is the difference between catching the
  // spike and ending the demo one beat early.
  console.log(`${GREY}\n(end of call — final pass)${RESET}`);
  await analyzer.flush();
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
