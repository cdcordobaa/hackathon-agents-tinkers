/**
 * Adapted from ../../mobile/scripts/mint-token.mjs — same shape, same three
 * required env vars, same reasoning for why a long-lived token beats a token
 * server for a two-day event. The only change is which keys get written:
 * this writes `VITE_LIVEKIT_URL` / `VITE_LIVEKIT_TOKEN` (Vite bakes
 * `VITE_`-prefixed vars in at build time; Expo used `EXPO_PUBLIC_`), and it
 * writes into web/.env rather than mobile/.env.
 *
 * Mint a second token with a different `--identity`, same `--room`, to join
 * from the phone or a second browser tab — two participants in the room is
 * the call.
 *
 *   npm run token -- --room demo --identity browser
 *   npm run token -- --room demo --identity browser --hours 48
 *
 * Needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in web/.env, all
 * three from the LiveKit Cloud dashboard under Settings → Keys — the same
 * three mobile/.env already needs, so copying that file's values here is
 * enough.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AccessToken } from "livekit-server-sdk";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const room = flag("room", "demo");
const identity = flag("identity", "browser");
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
  console.error(`Missing in web/.env: ${missing.join(", ")}`);
  console.error("Copy web/.env.example to web/.env and fill it from the LiveKit Cloud dashboard");
  console.error("(the same three values mobile/.env already has).");
  process.exit(1);
}

const token = new AccessToken(apiKey, apiSecret, { identity, ttl: hours * 3600 });
token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
const jwt = await token.toJwt();

// Rewrite only the two VITE_LIVEKIT_ keys, leaving everything else in .env
// (including the API secret) untouched.
const path = ".env";
const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
const keep = existing
  .split("\n")
  .filter((line) => !/^VITE_LIVEKIT_(URL|TOKEN)=/.test(line))
  .join("\n")
  .replace(/\n+$/, "");

writeFileSync(
  path,
  `${keep}\nVITE_LIVEKIT_URL=${url}\nVITE_LIVEKIT_TOKEN=${jwt}\nVITE_LIVEKIT_ROOM=${room}\nVITE_LIVEKIT_IDENTITY=${identity}\n`,
);

console.log(`Wrote web/.env — room "${room}", identity "${identity}", valid ${hours}h.`);
console.log("Restart `npm run dev` (Vite reads VITE_ vars at server start, not per-request).");
