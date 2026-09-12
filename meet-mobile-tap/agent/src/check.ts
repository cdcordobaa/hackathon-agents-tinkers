/**
 * Preflight: one small call that proves the key, the model name and structured
 * output all work together.
 *
 * Worth its own script because the three fail differently and the replay hides
 * which one it was behind a stream of turns — a bad model name and a bad key
 * both just look like "analysis failed" six seconds in.
 *
 *   npm run check
 */
import { resolveModelSetup, type ModelSetup } from "./model-client.ts";
import { RISK_PROFILE_SCHEMA } from "./risk-profile.ts";
import type { RiskProfile } from "./risk-profile.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const GREY = "\x1b[90m";
const RESET = "\x1b[0m";

async function main(): Promise<void> {
  let setup: ModelSetup;
  try {
    setup = resolveModelSetup();
  } catch (cause) {
    console.error(`${RED}✗${RESET} ${cause instanceof Error ? cause.message : cause}`);
    process.exit(1);
  }

  console.log(`${GREY}provider${RESET}  ${setup.provider}`);
  console.log(`${GREY}model${RESET}     ${setup.model}`);
  console.log(`${GREY}strict${RESET}    ${setup.supportsStrictSchema ? "yes" : "no (Gemini shim)"}`);
  console.log(`${GREY}interval${RESET}  ${setup.suggestedIntervalMs}ms`);
  console.log("");

  const startedAt = Date.now();
  try {
    const response = await setup.client.chat.completions.create({
      model: setup.model,
      messages: [
        {
          role: "system",
          content:
            "You assess a call for fraud risk. Reply with the schema. This is a connectivity test.",
        },
        {
          role: "user",
          content:
            'Transcript: [00:00] caller: Good morning, this is a test call.\nReturn risk "none".',
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "risk_profile",
          ...(setup.supportsStrictSchema ? { strict: true as const } : {}),
          schema: RISK_PROFILE_SCHEMA,
        },
      },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned no content.");

    const profile = JSON.parse(raw) as RiskProfile;
    const latency = Date.now() - startedAt;

    // Parsing is not enough — a model that ignores the schema still returns
    // valid JSON. Check the fields the analyzer actually reads.
    const missing = (["risk", "score", "headline", "signals", "advice", "changed"] as const).filter(
      (key) => profile[key] === undefined,
    );

    if (missing.length > 0) {
      console.log(`${RED}✗${RESET} schema not honoured — missing: ${missing.join(", ")}`);
      console.log(`${GREY}${raw.slice(0, 300)}${RESET}`);
      process.exit(1);
    }

    console.log(`${GREEN}✓${RESET} structured output works  ${GREY}${latency}ms${RESET}`);
    console.log(`${GREY}  risk=${profile.risk} score=${profile.score}${RESET}`);
    console.log(`${GREY}  "${profile.headline}"${RESET}`);
    console.log("");
    console.log(`Ready. Run ${GREY}npm run replay${RESET}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.log(`${RED}✗${RESET} ${message}`);
    console.log("");

    if (/api key|unauthor|401|invalid.*key|permission/i.test(message)) {
      console.log("The key was rejected. Check it is pasted whole and matches the provider.");
    } else if (/\b400\b/.test(message)) {
      // Gemini answers a bad key with a bodyless 400, so the generic advice
      // has to lead with the key rather than the schema.
      console.log("A bodyless 400 from Gemini almost always means the key is wrong or revoked.");
      console.log("Check it at https://aistudio.google.com/apikey — then check ANALYSIS_MODEL.");
    } else if (/not found|404|does not exist|unsupported model/i.test(message)) {
      console.log(`"${setup.model}" is not a model this key can reach.`);
      console.log("Set ANALYSIS_MODEL to one your account has.");
      if (setup.provider === "gemini") {
        console.log("Free Gemini tier is Flash models only — Pro left the free tier in 2026.");
      }
    } else if (/429|rate|quota|resource.*exhaust/i.test(message)) {
      console.log("Rate limited on the very first call — the free tier quota may be spent.");
      console.log("Free Gemini is single-digit requests per minute; wait a minute and retry.");
    }
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
