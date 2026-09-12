/**
 * Credential preflight — run this before the demo, not during it.
 *
 * A wrong LIVEKIT_API_SECRET does not fail at `npm run token`: minting a JWT
 * is pure local crypto and happily signs with garbage. It fails later, in the
 * browser, as a connect error that looks like a network problem. This calls
 * the LiveKit server API, which actually verifies the signature, so a bad key
 * fails here — cheaply, with a name attached.
 *
 *   npm run preflight
 */
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;

const missing = [["LIVEKIT_URL", url], ["LIVEKIT_API_KEY", key], ["LIVEKIT_API_SECRET", secret]]
  .filter(([, v]) => !v)
  .map(([n]) => n);
if (missing.length > 0) {
  console.error(`Missing in web/.env: ${missing.join(", ")}`);
  process.exit(1);
}

// The server API speaks HTTPS; the client SDK speaks WSS. Same host.
const httpUrl = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

try {
  const rooms = await new RoomServiceClient(httpUrl, key, secret).listRooms();
  console.log(`OK   credentials verified against ${httpUrl}`);
  console.log(
    `     rooms open: ${rooms.length}${rooms.length ? ` — ${rooms.map((r) => `${r.name} (${r.numParticipants}p)`).join(", ")}` : ""}`,
  );
} catch (cause) {
  console.error(`FAIL ${cause?.message ?? cause}`);
  console.error("     Check LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL in web/.env.");
  process.exit(1);
}

const token = new AccessToken(key, secret, { identity: "preflight", ttl: 60 });
token.addGrant({ roomJoin: true, room: "demo", canPublish: true, canSubscribe: true });
const jwt = await token.toJwt();
console.log(`OK   minted a room token (${jwt.length} chars, 60s ttl, discarded)`);
