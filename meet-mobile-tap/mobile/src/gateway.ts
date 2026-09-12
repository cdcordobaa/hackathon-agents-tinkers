import { MONITOR_IDENTITY } from "../../shared/session";

export const DEFAULT_GATEWAY_URL =
  process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() || "http://localhost:8787";

export type JoinCredentials = {
  url: string;
  token: string;
  roomName: string;
  identity: string;
  monitorIdentity: string;
};

type JoinRequest = {
  gatewayUrl: string;
  roomName: string;
  displayName: string;
};

const CLIENT_IDENTITY = `mobile-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readableMessage = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  for (const key of ["message", "error", "detail"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 240);
  }
  return undefined;
};

const normalizeGatewayUrl = (value: string): string => value.trim().replace(/\/+$/, "");

export function validateJoinInput(request: JoinRequest): string | undefined {
  const gatewayUrl = normalizeGatewayUrl(request.gatewayUrl);
  if (!/^https?:\/\/[^\s]+$/i.test(gatewayUrl)) {
    return "Enter a gateway URL beginning with http:// or https://.";
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(request.roomName.trim())) {
    return "Room names can use letters, numbers, hyphens, and underscores.";
  }
  const displayName = request.displayName.trim();
  if (displayName.length < 2 || displayName.length > 60) {
    return "Enter a display name between 2 and 60 characters.";
  }
  return undefined;
}

export async function requestJoinCredentials(request: JoinRequest): Promise<JoinCredentials> {
  const gatewayUrl = normalizeGatewayUrl(request.gatewayUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/api/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: request.roomName.trim(),
        identity: CLIENT_IDENTITY,
        displayName: request.displayName.trim(),
        role: "subject",
        consent: true,
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("The gateway did not respond. Check that it is running on port 8787.");
    }
    throw new Error(
      `Could not reach ${gatewayUrl}. On a phone, use this computer's LAN address instead of localhost.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`The gateway returned ${response.status}. Check its terminal for details.`);
    }
    throw new Error("The gateway returned an unreadable join response.");
  }

  if (!response.ok) {
    throw new Error(
      readableMessage(payload) ??
        `The gateway rejected the join request (${response.status}). Check the room settings.`,
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.url !== "string" ||
    !/^wss?:\/\/[^\s]+$/i.test(payload.url) ||
    typeof payload.token !== "string" ||
    payload.token.length < 16 ||
    typeof payload.roomName !== "string" ||
    !payload.roomName ||
    typeof payload.identity !== "string" ||
    !payload.identity ||
    payload.monitorIdentity !== MONITOR_IDENTITY
  ) {
    throw new Error("The gateway returned an incomplete join response. Restart the gateway and try again.");
  }

  return {
    url: payload.url,
    token: payload.token,
    roomName: payload.roomName,
    identity: payload.identity,
    monitorIdentity: payload.monitorIdentity,
  };
}
