## Context

CLAUDE.md rejected Twilio for the MVP on one specific ground: trial accounts play a
"you have a trial account" preamble before connecting, which is a bad thing to have happen
in front of judges. Everything else about the path was judged sound — real PSTN, audio
forked server-side with `<Start><Stream>`, no raw-audio native module needed because the
samples never touch the phone.

The decision now is to run both transports behind `CallTransport`. See proposal.md — Why.

## Goals / Non-Goals

**Goals**
- Real inbound PSTN audio reaching the same pipeline the replay path reaches.
- An honest measurement of narrowband STT quality before the demo depends on it.
- Call control (speak, hang up) that the intervention track can actually use.

**Non-Goals**
- A Colombian DID. CLAUDE.md establishes that owning one needs regulatory documents, and
  that *calling* a Colombian number needs no Colombian number. The demo calls out.
- Twilio Verify and Lookup. Those are fraud signals, not transport —
  add-caller-reputation-signals and add-fraud-intervention own them.
- Carrier-grade reliability, reconnection across a dropped webhook, or call recording.

## Decisions

### Fork the audio with `<Start><Stream>`, do not record

`<Start><Stream>` opens a WebSocket to the gateway and streams the call live, which is what
a live risk score needs. Twilio's recording products produce a file after the fact.

### Ask for dual-track, and treat single-track as a failure

`<Stream track="both_tracks">` delivers inbound and outbound legs separately. That maps
directly onto `subject` and `counterparty` with no inference — the one place where Twilio
is strictly better than LiveKit, which cannot tell which participant is the protected user.

If only a mixed track arrives, the adapter reports an error rather than emitting both
parties under one speaker id. A mixed track would silently destroy the analyzer's ability
to attribute a pretext to the caller, and the resulting risk profile would quote the wrong
speaker — a failure that reads as a model problem and is not one.

### Resample inside the adapter, and measure what it costs

Twilio media is 8 kHz μ-law. Upsampling to 24 kHz satisfies the format contract but does
not restore the missing band. Whether that degrades transcription enough to matter is an
empirical question, so the plan measures it: the same fixture audio through both a 24 kHz
path and a downsample-to-8 kHz-and-back path, word error rate compared.

*Alternative considered:* have the transcription layer accept a sample rate per stream.
Rejected — it pushes a codec matrix into every consumer and breaks the property that makes
the tracks independent. If narrowband turns out to need a different STT configuration, that
belongs in a transport hint, not a format escape hatch.

### The trial preamble is a scheduled task, not a runtime concern

No code can remove it. Upgrading the account removes it. So it is task 1.1, with an
end-to-end phone call verifying the preamble is gone at least a day before the demo, and
the fallback ladder is what covers the case where that slips.

### The RN Voice SDK is a spike before it is a dependency

`mobile/` is Expo 57 / RN 0.86 with a generated iOS project and LiveKit's WebRTC pods
already installed (1.3 GB). Adding a second telephony native module to that is the highest
uncertainty in this change, and it is not on the critical path: the gateway can place and
monitor a call with no app changes at all. So the spike is time-boxed, and if it fails the
transport still works with the phone dialling in from its native dialer.

## Risks / Trade-offs

- **Trial preamble in front of judges.** → Upgrade the account and verify with a real call
  ≥24h before the demo; LiveKit remains the fallback rung.
- **Narrowband audio degrades detection.** → Measured in task 3.3 rather than assumed. If
  word error rate rises materially, the demo script leads on LiveKit and shows Twilio as
  the production path.
- **Two telephony native modules in one Expo app.** → Time-boxed spike; the transport does
  not depend on it. CLAUDE.md's pod-install failure modes (`~/.netrc` permissions, nvm's
  lazy `node` shell function, `prebuild` exiting 0 after a failed `pod install`) are known
  and documented — check for `ios/*.xcworkspace` rather than trusting the exit code.
- **Webhooks need a public URL.** A tunnel that dies takes the path with it. → The tunnel
  URL is part of the pre-demo checklist, and the fallback ladder covers its loss.
- **Twilio charges per minute and the demo is live.** → Low, but set a spend alert.

## Migration Plan

Additive. LiveKit keeps working throughout; both register with the same registry and the
session picks by transport kind. CLAUDE.md's Decision section is rewritten only once a real
call has reached the pipeline, so the document never claims a path that has not run.

## Open Questions

- Whether `@twilio/voice-react-native-sdk` has a maintained Expo config plugin, or whether
  the spike ends in a hand-written one. Resolved by task 4.1; does not block the transport.
- Whether the demo is an inbound call to a Twilio number or an outbound call placed by the
  gateway. Inbound tells the better story; outbound is easier to control on stage. Decided
  with the demo script in add-integration-and-demo.
