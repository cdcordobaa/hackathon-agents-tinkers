export type RecordingRole = "counterparty" | "subject";
export type RecordingCue = { role: RecordingRole; offsetMs: number; durationMs: number };
export const RECORDING_GAP_MS = 450;
export const MAX_RECORDING_DURATION_MS = 120_000;

/** One complete intervention per file, other caller first, then protected person. */
export function planRecordings(durations: Record<RecordingRole, number>): RecordingCue[] {
  for (const duration of Object.values(durations)) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_RECORDING_DURATION_MS) {
      throw new Error("Each recording must contain between 0 and 120 seconds of audio.");
    }
  }
  return [
    { role: "counterparty", offsetMs: 0, durationMs: durations.counterparty },
    { role: "subject", offsetMs: durations.counterparty + RECORDING_GAP_MS, durationMs: durations.subject },
  ];
}
