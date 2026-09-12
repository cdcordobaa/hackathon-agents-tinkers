# Shared call contracts

The browser, native app, monitor, and session gateway import these contracts directly.
This package contains browser-safe validation and receipt logic as well as types; it has
no runtime dependencies or provider credentials.

## Live room snapshots

`session.ts` defines `CallSnapshot`, `CallParticipant`, `CallTurn`, the reserved
`MONITOR_IDENTITY`, and `SESSION_TOPIC`. `parseCallSnapshot` validates the payload shape
and size. These are complete snapshots, including the monitor's bounded transcript
window and latest assessment, sent over the LiveKit room's reliable data channel.

`room-session.ts` is the receiver used by both browser and native clients:

- `acceptRoomSnapshot` verifies publisher identity, topic, room, schema, and order.
  Duplicates do not refresh the receipt time. A later monitor generation (`startedAt`)
  can restart sequence numbering; old-generation packets cannot overwrite it.
- `currentRoomProfile` only exposes a profile for a listening or analyzing monitor
  within 15 seconds of the client's last accepted packet. Clients additionally suppress
  it while their RTC connection is down. Freshness uses the local receipt clock.
- `initialRoomSession` creates an empty client state for a new join attempt.

The native `mobile/src/livekit/` adapter projects this state into the existing mobile
HUD model and retains up to 500 observed turns for the local summary. Each snapshot
replaces the current room window; a missing sequence number is not treated as a hole
in an incremental event log.

## Session events and transcript sources

`src/events.ts` defines the replay/ingest gateway's `SessionEvent` and `ClientMessage`:

| Direction | Messages |
| --- | --- |
| Server → client | `session.state`, `transcript.turn`, `risk.updated`, `transcript.degraded`, `error` |
| Client → server | `session.start`, `session.end`, `consent.granted`, `consent.declined`, `subscribe` |

Every event has a session ID, incrementing sequence, and relative timestamp. Unlike
room snapshots, these events are incremental: the mobile reducer detects sequence gaps
and skips replayed duplicates. The WebSocket URL addresses one session.

`src/transcript-source.ts` describes sources that emit speaker-labelled transcript
segments. `server/` implements replay and browser segment ingestion; the source's
`providerEventKey` and `sequence` support deduplication and ordering. The integrated
LiveKit monitor captures native/browser audio server-side and publishes snapshots;
it does not create a second event session or run a duplicate analyzer for the call.
Twilio is a declared source kind with no implementation yet.

`src/speaker.ts` defines the roles `subject`, `counterparty`, and `unknown`.
`src/risk.ts` and `session.ts` both re-export the single `RiskProfile` definition from
`agent/src/risk-profile.ts`; there is no separate mobile or browser risk schema.

OpenSpec reconciliation, durable event history, and final reports remain pending.

## Verification

```bash
cd shared
npm ci
npm run typecheck
cd ../agent
node --import tsx --test src/session.test.ts src/room-session.test.ts
```
