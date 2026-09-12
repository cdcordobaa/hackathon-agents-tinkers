# Xentinela — app shell

The client UI for the call-scam sentinel. Front end only: every screen runs on
in-memory state, and no detection, telephony or messaging is wired in yet.

## Run it

```bash
npm run go     # Expo Go — scan the QR with the Expo Go app
npm run web    # same app in a browser at http://localhost:8088
```

Port 8088 rather than the default 8081, because the sibling `meet-mobile-tap`
Metro server already holds 8081.

There are **no native modules** in this project — that is deliberate. It is what
lets the whole thing run in Expo Go without a development build.

## Map

Four tabs and a one-level stack, hand-rolled in `App.tsx` with plain state.

| Tab | File | What it does |
|---|---|---|
| Shield | `src/screens/Shield.tsx` | Protection state, counters, three most recent calls |
| Activity | `src/screens/Activity.tsx` | Every analysed call, filterable, grouped by day |
| People | `src/screens/People.tsx` | Channel, and the guardians who get alerted |
| Settings | `src/screens/Settings.tsx` | Protection switch and the way into privacy |

Pushed on top: `CallDetail`, `AddGuardian`, `Privacy`. The tab screens stay
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

## Wiring it up later

`src/store.tsx` is the whole seam. Replace `seedCalls` with records pushed from
the detection engine and nothing in the screens has to change. Keep alerts as
structured data — verdict, number, time, reason codes — rather than a formatted
string, or the WhatsApp path (which needs pre-approved templates) becomes a
rewrite.

Copy is English and inline in each screen; Spanish is a pass over the screen
files, not a refactor.
