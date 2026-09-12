# Xentinela — app shell

The client UI for the call-scam sentinel, wired to the detection gateway. The
Live tab runs a real call through the real pipeline: the transcript is what the
transport heard, and the risk band is the analyzer's own pass. The other tabs
still open on seeded calls, and telephony and guardian messaging are still not
connected — nothing sends a Telegram message.

## Run it

The gateway first, then the app. Nothing on the Live tab works without it.

```bash
cd ../meet-mobile-tap && npm run dev    # the combined gateway, port 8787
```

```bash
npm run go     # Expo Go — scan the QR with the Expo Go app
npm run web    # same app in a browser at http://localhost:8088
```

The app finds the gateway on whichever machine Metro served the bundle from,
so Expo Go on a phone needs no `.env` edit. Set `EXPO_PUBLIC_GATEWAY_URL` only
to override that — the Android emulator wants `http://10.0.2.2:8787`. The web
build is a cross-origin caller, so the gateway needs its origin in
`ALLOWED_ORIGINS`; a phone sends no `Origin` header and never needs one.

Port 8088 rather than the default 8081, because the sibling `meet-mobile-tap`
Metro server already holds 8081.

There are **no native modules** in this project — that is deliberate. It is what
lets the whole thing run in Expo Go without a development build.

## Map

Five tabs and a one-level stack, hand-rolled in `App.tsx` with plain state.

| Tab | File | What it does |
|---|---|---|
| Shield | `src/screens/Shield.tsx` | Protection state, counters, three most recent calls |
| Live | `src/screens/LiveCall.tsx` | A call being analysed right now, off the gateway |
| Activity | `src/screens/Activity.tsx` | Every analysed call, filterable, grouped by day |
| People | `src/screens/People.tsx` | Channel, and the guardians who get alerted |
| Settings | `src/screens/Settings.tsx` | Protection switch and the way into privacy |

Pushed on top: `CallDetail`, `AddGuardian`, `Privacy`, `Alerts`. The tab screens stay
mounted underneath, so going back restores the filter and scroll position.

## Two conventions worth knowing

**Colour means risk, and nothing else.** Teal is the resting state, amber is a
soft signal, red is a verdict. Nothing decorative borrows those three.

**Grey means soft locked.** Every primitive takes a `muted` prop: the control
renders in grey and stops responding, with no lock glyph and no "coming soon"
caption. Currently soft locked — WhatsApp, sensitivity, the two rules, language,
and the three actions inside Privacy.

## Alerting scope

Every guardian is messaged at the same time, on Telegram. No ordering, no
escalation ladder, no acknowledgement state — those need a guardian-side surface
that does not exist yet, and the UI does not imply them anywhere.

## How the live path fits

`src/live/` is the gateway half: `client.ts` holds the session socket,
`useLiveCall.ts` exposes it to React, and `wire.ts` restates the gateway's
event types (a copy, deliberately — Metro only watches this project's root).

`src/store.tsx` is still the seam it was designed to be. `LiveCall` writes a
finished call through `logCall` and it appears in Activity next to every other
one, with no change to any screen.

The alert overlay draws from analyzer passes, not from its scripts. A live
alert is a view onto the session `LiveCall` holds, so it files no record of its
own, and "hang up" is routed back to that screen. Settings → Warnings still
shows the three levels on scripted content, for judging wording and timing.

Still not wired: telephony, and the guardian messaging the ended-call copy
describes. Nothing sends a Telegram message.

Copy is English and inline in each screen; Spanish is a pass over the screen
files, not a refactor.
