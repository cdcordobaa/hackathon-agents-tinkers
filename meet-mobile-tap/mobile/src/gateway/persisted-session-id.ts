/**
 * Best-effort memory for the last gateway session id this phone joined, so
 * a reload mid-demo does not mean retyping a pasted UUID.
 *
 * Deliberately NOT AsyncStorage, SecureStore, expo-file-system, or any other
 * native module: ../../CLAUDE.md and this task are explicit that nothing in
 * mobile/ may need a new native module in this pass — CopilotKit sits on
 * `/headless` and the LiveKit iOS project is already built specifically so
 * no `expo prebuild` / `pod install` is ever needed again, and pulling in a
 * storage package would force exactly that (even an Expo-authored one still
 * needs linking into the compiled dev client).
 *
 * So this is genuinely best-effort, not a real persistence layer:
 *  - On the web target (`npm run web`), `window.localStorage` is real
 *    browser storage and survives a full page reload — this is the one case
 *    that actually satisfies "a reload does not mean retyping."
 *  - On iOS/Android there is no store backing this at all, only an
 *    in-memory module-level fallback. That survives a component remount and
 *    Fast Refresh (module state is not torn down for those) but NOT a full
 *    app kill or a dev-menu "Reload" — those reinitialise the JS context,
 *    and the id is lost. This gap is real, and unverified beyond this
 *    reasoning: there is no device to confirm it on. See this task's return
 *    notes.
 */
const KEY = "secureguia.lastJoinedSessionId";

let memoryFallback = "";

function webStorage(): Storage | undefined {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) return undefined;
    // Merely referencing `.localStorage` never throws; touching a property
    // on it can, in a locked-down webview that stubs the object out.
    void store.length;
    return store;
  } catch {
    return undefined;
  }
}

export function loadLastJoinedSessionId(): string {
  const store = webStorage();
  if (store) {
    try {
      return store.getItem(KEY) ?? "";
    } catch {
      // Fall through to the in-memory value below.
    }
  }
  return memoryFallback;
}

export function saveLastJoinedSessionId(id: string): void {
  memoryFallback = id;
  const store = webStorage();
  if (!store) return;
  try {
    store.setItem(KEY, id);
  } catch {
    // Best-effort only — see the file header.
  }
}
