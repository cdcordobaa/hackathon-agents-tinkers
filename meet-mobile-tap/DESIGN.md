# Xentinela interface

Xentinela is a calm call-room instrument. It should make live state, observed audio, current evidence, and the next safe action legible within a glance. The browser and mobile surfaces share the same dark teal identity and direct language.

## Palette

- Canvas: `#081416` in the browser and `#0E181A` on mobile.
- Primary surfaces: deep teal-black from `#0D1B1E` through `#13282C`.
- Text: cool white `#EFF8F9`; secondary copy uses blue-gray `#9DB1B6`.
- Active call and audio: cyan `#3FC6D1`, with `#91E8ED` for high-contrast labels.
- Current safe/low evidence: green `#64D7AD`.
- Elevated risk and simulated-preview framing: amber `#F1BD64`.
- High risk, errors, and leave actions: coral `#EE8276`.

## Form and hierarchy

Use the system sans-serif stack, compact controls, flat bordered surfaces, and tabular figures for elapsed time, levels, and scores. Borders provide structure; shadows are reserved for the setup panel. Body copy stays at least 13px on operational screens. Corners are 8px for controls and 14px for primary panels.

The live screen prioritizes call state, people and audio movement, risk guidance, evidence, then transcript. Scores never appear as current without a fresh validated monitor snapshot. A stale update removes the score and action guidance and says that the transcript may be out of date.

## State rules

- Live rooms use cyan state markers and the explicit label “Live room.”
- Offline preview uses persistent amber “Simulated preview” and “Demo preview — no live call” labels. Preview data never appears as a real connection or model result.
- Missing configuration says “Not configured.” Health checks say “Configured,” never “Ready,” because they do not verify provider connectivity.
- Missing analysis stays pending with an em dash instead of a reassuring zero.
- Audio level and risk meters animate with left-origin transforms and respect reduced-motion preferences.
- Consent is required before any live join; the preview does not open a microphone or call service.
