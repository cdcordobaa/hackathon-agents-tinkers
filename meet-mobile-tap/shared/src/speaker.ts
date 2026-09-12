/**
 * The one participant model every surface agrees on.
 *
 * `role` is honest, not inferred. Twilio's real-time transcription gives us
 * leg direction for free, so it can say `subject` / `counterparty` outright.
 * LiveKit cannot tell which participant is the protected user — a transport
 * that does not know MUST report `unknown` rather than guess, because a wrong
 * guess here silently flips who a risk signal is quoting.
 */

export type SpeakerRole = "subject" | "counterparty" | "unknown";

export type Speaker = {
  /** Stable for the lifetime of the session; used to key transcript turns. */
  id: string;
  /** Human-readable, shown in the UI — "You", "Caller", a Twilio leg label. */
  label: string;
  role: SpeakerRole;
};
