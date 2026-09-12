/**
 * The agent. Server-side only.
 *
 * A factory, never a shared instance — one fresh agent per thread. The web
 * runtime calls this per resolution.
 */
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { SYSTEM_PROMPT } from "./prompt";

const DEFAULT_MODEL = "gpt-5.6-sol";

function resolveModel(): string {
  const model = (process.env.MODEL || DEFAULT_MODEL).trim();
  const provider = (process.env.MODEL_PROVIDER || "openai").trim().toLowerCase();

  const keyNames: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
  };

  const keyName = keyNames[provider];
  if (!keyName) {
    throw new Error(
      `Unsupported MODEL_PROVIDER '${provider}'. Use openai, anthropic, or google.`,
    );
  }
  if (!process.env[keyName]) {
    throw new Error(`${keyName} is required for ${provider}. Set it in .env.local.`);
  }

  // Already provider-prefixed (e.g. "openai:gpt-5.6-sol")? Leave it alone.
  return model.includes(":") ? model : `${provider}:${model}`;
}

export function makeAgent(threadId: string) {
  const agent = new BuiltInAgent({
    model: resolveModel(),
    prompt: SYSTEM_PROMPT,

    // NOT optional. maxSteps defaults to 1: the agent would call one tool and
    // stop before ever seeing the result, which breaks the whole feedback loop.
    maxSteps: 10,
  });

  agent.threadId = threadId;
  return agent;
}
