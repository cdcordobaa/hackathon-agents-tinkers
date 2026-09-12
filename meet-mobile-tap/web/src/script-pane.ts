/**
 * Renders agent/src/fixtures/bank-scam.ts as readable lines so whoever plays
 * the caller in the second tab reads the same pretext the eval fixtures use —
 * this is what makes a live demo land at a known moment (the OTP ask, right
 * at the end) instead of improvising into dead air. Pure data import: this
 * pulls in no runtime dependency of agent/ (the fixture file is just a typed
 * array literal), so it costs nothing to bundle.
 */
import { BANK_SCAM } from "../../agent/src/fixtures/bank-scam.ts";

const WHO_LABEL: Record<string, string> = { caller: "Caller (them)", you: "You (subject)" };

export function renderScriptPane(container: HTMLElement): void {
  container.innerHTML = "";
  for (const turn of BANK_SCAM) {
    const line = document.createElement("div");
    line.className = "script-line";

    const who = document.createElement("span");
    who.className = "who";
    who.textContent = WHO_LABEL[turn.speaker] ?? turn.speaker;
    line.appendChild(who);

    const text = document.createElement("span");
    text.textContent = turn.text;
    line.appendChild(text);

    container.appendChild(line);
  }
}
