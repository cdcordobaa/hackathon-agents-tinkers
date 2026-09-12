## Scope as of now

**[DEFERRED, not cancelled]** Caller reputation / Twilio Lookup is explicitly out of
scope for the current build (it is on the deferred list alongside SMS, Twilio Verify,
Telegram, hangup, and the post-call case file). Nothing in this change should be started
before those higher-priority tracks (T1 contract+gateway, T2 Twilio real-time
transcription, T3 mobile CopilotKit HUD) are working end to end. The specs under
`specs/` and the tasks below still describe the full original intent, so the work is
ready to pick up when there is time — see `tasks.md` for the per-task deferral tags.

## Why

The transcript-based analyzer cannot say anything until someone speaks. By then the call is
connected and the pretext has started. There is information available *before* the first
word — who is calling, from what kind of line, on a number that changed hands last week —
and it is the cheapest signal in the system.

It also fixes the analyzer's worst blind spot. A caller claiming to be the user's bank is
just a claim in a transcript; the fact that the call arrived from a VoIP number registered
three days ago is evidence.

## What Changes

- Twilio Lookup on the far-end number before or at connection: line type, carrier, caller
  name where available, and portability or recent-change indicators.
- A local scam-number list, checked first, so a known-bad number is flagged with no network
  call and the demo has a deterministic path.
- A `CallerReputation` result published as a `signal.caller` session event, so the mobile
  app can show a pre-answer verdict card.
- The reputation carried into the analyzer's context as **context, never as a conclusion** —
  a VoIP line is not fraud, and an analyzer that treats it as one will flag every call from
  a softphone.
- Honest absence: Lookup failing, being unavailable, or having nothing to say is reported as
  unknown, not as clean. An unreachable API must not read as a green light.
- Caching by number, because the same demo number will be looked up repeatedly.

## Capabilities

### New Capabilities
- `caller-reputation`: what can be known about the other party before they speak, and how
  confidently.

## Impact

- New: `server/src/signals/caller-reputation.ts`, a lookup provider interface with a Twilio
  implementation and a fixture implementation.
- `fraud-analysis`: the analysis prompt gains a caller-context section. The schema does not
  change.
- Requires Twilio credentials on the gateway. Lookup is billed per query.
- Only meaningful on the Twilio transport, where a real number exists. On LiveKit and replay
  the provider returns unknown, and the UI shows it as unavailable.
- Depends on: add-call-session-contracts.
