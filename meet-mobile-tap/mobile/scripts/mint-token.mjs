/**
 * Mints a LiveKit access token and writes it into .env.
 *
 * The MVP deliberately has no token server. A token server is the right answer
 * for anything real — it is how you avoid shipping an API secret and how you
 * scope a token per user — but for a two-day event a long-lived token pasted
 * into .env removes a whole moving part, and the phone never has to reach your
 * laptop over the LAN.
 *
 *   npm run token -- --room demo --identity phone
 *   npm run token -- --room demo --identity laptop --hours 48
 *
 * Needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env, all three
 * from the LiveKit Cloud dashboard under Settings → Keys.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AccessToken } from "livekit-server-sdk";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const room = flag("room", "demo");
const identity = flag("identity", "phone");
const hours = Number(flag("hours", "48"));

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

const missing = [
  ["LIVEKIT_URL", url],
  ["LIVEKIT_API_KEY", apiKey],
  ["LIVEKIT_API_SECRET", apiSecret],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill it from the LiveKit Cloud dashboard.");
  process.exit(1);
}

const token = new AccessToken(apiKey, apiSecret, { identity, ttl: hours * 3600 });
token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
const jwt = await token.toJwt();

// Rewrite only the two EXPO_PUBLIC_ keys, leaving everything else in .env
// untouched — the API secret lives in the same file and must survive this.
const path = ".env";
const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
const keep = existing
  .split("\n")
  .filter((line) => !/^EXPO_PUBLIC_LIVEKIT_(URL|TOKEN)=/.test(line))
  .join("\n")
  .replace(/\n+$/, "");

writeFileSync(
  path,
  `${keep}\nEXPO_PUBLIC_LIVEKIT_URL=${url}\nEXPO_PUBLIC_LIVEKIT_TOKEN=${jwt}\n`,
);

console.log(`Wrote .env — room "${room}", identity "${identity}", valid ${hours}h.`);
console.log("Restart Metro with --clear; EXPO_PUBLIC_ vars are baked in at bundle time.");
