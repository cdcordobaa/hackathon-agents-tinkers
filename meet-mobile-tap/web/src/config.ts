/**
 * Every value here is editable in the UI at demo time — a hackathon demo
 * that depends on nobody fat-fingering an env var before the flight is a
 * demo that breaks in the green room. `import.meta.env` values (baked in at
 * build time, `VITE_`-prefixed) are only the *defaults* shown in the input;
 * `localStorage` remembers the last values a human actually typed, so a
 * refresh mid-rehearsal does not lose a pasted token.
 */
export type AppConfig = {
  livekitUrl: string;
  livekitToken: string;
  room: string;
  identity: string;
  gatewayUrl: string;
  tokenServerUrl: string;
};

const STORAGE_KEY = "secureguia.web.config";

const DEFAULTS: AppConfig = {
  livekitUrl: (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? "",
  livekitToken: (import.meta.env.VITE_LIVEKIT_TOKEN as string | undefined) ?? "",
  room: (import.meta.env.VITE_LIVEKIT_ROOM as string | undefined) ?? "demo",
  identity: (import.meta.env.VITE_LIVEKIT_IDENTITY as string | undefined) ?? "browser",
  gatewayUrl: (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? "http://localhost:8787",
  tokenServerUrl: (import.meta.env.VITE_TOKEN_SERVER_URL as string | undefined) ?? "http://localhost:8788",
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULTS, ...saved };
  } catch {
    // Private browsing, disabled storage, corrupt JSON — the env defaults
    // are a complete fallback, so this is never fatal.
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: AppConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Best-effort only — see loadConfig.
  }
}
