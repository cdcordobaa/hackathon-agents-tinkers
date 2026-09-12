/**
 * Adapted from
 * ../../../agents-everywhere-starter-kit/apps/web/src/lib/realtime-config.ts
 * (MIT, same workspace). Only the env-var source changed: the original reads
 * `NEXT_PUBLIC_*` (Next.js); this reads `VITE_*` (Vite). The model choice and
 * the comment explaining why transcription uses a different model than voice
 * are the original author's, kept verbatim.
 *
 * The listening path uses a different model from the talking path.
 *
 * `gpt-live-transcribe` streams deltas while the speaker is still talking,
 * which is what makes the call transcript feel live. `gpt-transcribe` is the
 * alternative: it waits for the turn to finish but reports detected language.
 */
export const TRANSCRIBE_MODEL =
  (import.meta.env.VITE_TRANSCRIBE_MODEL as string | undefined) ?? "gpt-live-transcribe";
