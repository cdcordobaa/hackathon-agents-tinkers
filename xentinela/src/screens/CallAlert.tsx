/**
 * The alert as it appears over the call — the only surface in the app the user
 * does not navigate to.
 *
 * It is drawn at the root, above the tabs and above any pushed route, because
 * the call itself is happening in the phone's dialer and this has to land on
 * top of it. Each level interrupts exactly as much as it has earned:
 *
 *   low       a strip at the top, taps pass through to whatever is underneath
 *   elevated  the screen is blocked, two ways out, both named
 *   high      the screen is taken, one way out, and it is the cancel
 *
 * There is no "none" branch. A level that has nothing to say says nothing.
 */
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, androidInset, styles as ui } from "../ui";
import { alertColor, alertTint, color, radius, space, type } from "../theme";
import { useStore } from "../store";
import { CUT_SECONDS, useAlert, type AlertSignal, type LiveAlert } from "../alerts";

const levelLabel = {
  low: "Low signal",
  elevated: "Take care",
  high: "High risk",
} as const;

export function AlertOverlay({ onOpenCall }: { onOpenCall: (id: string) => void }) {
  const { alert } = useAlert();
  if (!alert) return null;

  if (alert.level === "low") return <LowStrip alert={alert} />;
  return <Sheet alert={alert} onOpenCall={onOpenCall} />;
}

/**
 * Stage A. It sits where a heads-up notification sits, and it deliberately does
 * not cover the dialer's own controls — `box-none` lets every tap outside the
 * strip reach the call underneath.
 */
function LowStrip({ alert }: { alert: LiveAlert }) {
  const { dismiss } = useAlert();
  const tone = alertColor.low;

  return (
    <View style={[s.layer, s.layerTop]} pointerEvents="box-none">
      <View
        style={[s.card, { borderColor: tone }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Low signal. ${alert.headline}`}
      >
        <Source alert={alert} tone={tone} />
        <Text style={s.headline}>{alert.headline}</Text>
        <Signals signals={alert.signals} tone={tone} />
        <Text style={s.note}>
          Nothing to act on yet. Xentinela keeps listening and will say so if that changes.
        </Text>
        <View style={s.actions}>
          <Button label="Got it" onPress={dismiss} />
        </View>
        <Text style={s.footnote}>Closes on its own in 8 seconds</Text>
      </View>
    </View>
  );
}

/** Stages B and C, plus the end of the call that stage C leads to. */
function Sheet({ alert, onOpenCall }: { alert: LiveAlert; onOpenCall: (id: string) => void }) {
  const { guardians } = useStore();
  const { dismiss, hangUp, markLegitimate } = useAlert();
  const tone = alertColor[alert.level];
  const high = alert.level === "high";

  if (alert.phase === "ended") {
    return (
      <View style={[s.layer, s.scrim, s.layerCentre]} accessibilityViewIsModal>
        <View style={[s.card, s.cardWide, { borderColor: color.borderStrong }]}>
          <Source alert={alert} tone={color.textSecondary} />
          <Text style={s.headline}>Call ended</Text>
          <Text style={s.note}>
            The line is closed.{" "}
            {guardians.length === 0
              ? "No one was messaged — you have no one on your list yet."
              : `${guardians.length === 1 ? guardians[0].name : `All ${guardians.length} people on your list`} ${
                  guardians.length === 1 ? "was" : "were"
                } messaged on Telegram.`}
          </Text>
          <View style={s.actions}>
            <Button label="Close" onPress={dismiss} />
            {alert.loggedCallId ? (
              <Button
                label="What happened"
                tone="accent"
                onPress={() => {
                  const id = alert.loggedCallId;
                  dismiss();
                  if (id) onOpenCall(id);
                }}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  if (alert.phase === "ending") {
    return (
      <View style={[s.layer, s.scrimHeavy, s.layerCentre]} accessibilityViewIsModal>
        <View style={[s.card, s.cardWide, { borderColor: tone }]} accessibilityLiveRegion="assertive">
          <Source alert={alert} tone={tone} />
          <View style={s.endingRow}>
            <ActivityIndicator size="small" color={tone} />
            <Text style={s.headline}>Ending the call…</Text>
          </View>
          {/* Not "call ended": nothing has confirmed that yet. */}
          <Text style={s.note}>Waiting for the network to confirm it has stopped.</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[s.layer, high ? s.scrimHeavy : s.scrim, high ? s.layerCentre : s.layerBottom]}
      accessibilityViewIsModal
    >
      <View
        style={[s.card, s.cardWide, { borderColor: tone }]}
        accessibilityLiveRegion="assertive"
        accessibilityLabel={`${levelLabel[alert.level]}. ${alert.headline}`}
      >
        <Source alert={alert} tone={tone} />
        <Text style={[s.headline, high && s.headlineBig]}>{alert.headline}</Text>

        {high ? <Countdown seconds={alert.countdown} tone={tone} /> : null}

        {alert.advice ? (
          <View style={[s.advice, { backgroundColor: alertTint[alert.level] }]}>
            <Text style={[s.adviceLabel, { color: tone }]}>DO THIS NOW</Text>
            <Text style={s.adviceText}>{alert.advice}</Text>
          </View>
        ) : null}

        <Signals signals={alert.signals} tone={tone} />

        {high ? (
          <>
            {/* One button, and it is the way out — not the way on. Someone who
                is frightened should not be asked to choose. */}
            <View style={s.actions}>
              <Button label="Cancel · I know this caller" onPress={markLegitimate} />
            </View>
            <Text style={s.footnote}>
              You turned on automatic protection in Settings. Your list is being messaged on
              Telegram.
            </Text>
          </>
        ) : (
          <>
            <View style={s.actions}>
              <Button label="Stay on the call" onPress={dismiss} />
              <Button label="Hang up" tone="danger" onPress={hangUp} />
            </View>
            <Text style={s.footnote}>
              {guardians.length === 0
                ? "No one is on your alert list yet."
                : "Everyone on your list has been messaged on Telegram."}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Says whose alert this is and what it is sitting on top of. Xentinela does not
 * run the call, so the alert has to name the app that does — otherwise it reads
 * as the dialer's own warning.
 */
function Source({ alert, tone }: { alert: LiveAlert; tone: string }) {
  return (
    <View style={s.source}>
      <Ionicons name="shield-checkmark" size={15} color={tone} />
      <Text style={[s.sourceName, { color: tone }]}>Xentinela</Text>
      <Text style={s.sourceApp} numberOfLines={1}>
        over {alert.app} · {alert.number}
      </Text>
    </View>
  );
}

function Signals({ signals, tone }: { signals: AlertSignal[]; tone: string }) {
  if (signals.length === 0) return null;
  return (
    <View style={s.signals}>
      {signals.map((signal) => (
        <View key={signal.quote} style={s.signal}>
          <View style={[s.signalDot, { backgroundColor: tone }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.signalLabel}>{signal.label}</Text>
            {/* The quote is the evidence. A signal the app cannot quote is a
                signal it does not show. */}
            <Text style={s.signalQuote}>“{signal.quote}”</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Countdown({ seconds, tone }: { seconds: number; tone: string }) {
  return (
    <View style={s.countdown}>
      <View style={[s.countdownRing, { borderColor: tone }]}>
        <Text style={[s.countdownNumber, { color: tone }]}>{seconds}</Text>
      </View>
      <View style={{ flex: 1, gap: space.sm }}>
        <Text style={s.countdownLabel}>
          {seconds === 1 ? "Hanging up in 1 second" : `Hanging up in ${seconds} seconds`}
        </Text>
        <View style={s.countdownTrack}>
          <View
            style={[
              s.countdownFill,
              { backgroundColor: tone, width: `${(seconds / CUT_SECONDS) * 100}%` },
            ]}
          />
        </View>
        <Text style={s.countdownNote}>You do not have to do anything.</Text>
      </View>
    </View>
  );
}

/** Raises an alert from anywhere. Used by the preview screen; the engine will
 *  call `raise` directly. */
export function AlertTrigger({
  level,
  title,
  subtitle,
}: {
  level: "low" | "elevated" | "high";
  title: string;
  subtitle: string;
}) {
  const { raise } = useAlert();
  const tone = alertColor[level];
  return (
    <Pressable
      onPress={() => raise(level)}
      accessibilityRole="button"
      style={({ pressed }) => [s.trigger, pressed && ui.pressed]}
    >
      <View style={[s.triggerDot, { backgroundColor: tone }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.triggerTitle}>{title}</Text>
        <Text style={s.triggerSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="play" size={16} color={color.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: space.md,
  },
  layerTop: { justifyContent: "flex-start", paddingTop: androidInset + space.md },
  layerCentre: { justifyContent: "center" },
  layerBottom: { justifyContent: "flex-end", paddingBottom: space.xl },
  scrim: { backgroundColor: "rgba(4,8,7,0.72)" },
  scrimHeavy: { backgroundColor: "rgba(4,8,7,0.93)" },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
    // The alert is drawn over another app; without a shadow it reads as part of
    // whatever is behind it.
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.45,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  cardWide: { gap: space.lg },

  source: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceName: { ...type.eyebrow, textTransform: "uppercase" },
  sourceApp: { ...type.caption, color: color.textMuted, flex: 1 },

  headline: { ...type.title, color: color.text, lineHeight: 26 },
  headlineBig: { ...type.display, lineHeight: 34 },
  note: { ...type.label, color: color.textSecondary, lineHeight: 20 },
  footnote: { ...type.caption, color: color.textMuted, lineHeight: 17 },

  advice: { borderRadius: radius.md, padding: space.md, gap: space.xs },
  adviceLabel: { ...type.eyebrow },
  adviceText: { ...type.bodyStrong, color: color.text, lineHeight: 21 },

  signals: { gap: space.md },
  signal: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  signalDot: { width: 6, height: 6, borderRadius: radius.pill, marginTop: 7 },
  signalLabel: { ...type.label, color: color.text, fontWeight: "600" },
  signalQuote: { ...type.caption, color: color.textSecondary, lineHeight: 18, marginTop: 2 },

  countdown: { flexDirection: "row", alignItems: "center", gap: space.lg },
  countdownRing: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNumber: { fontSize: 32, fontWeight: "600" },
  countdownLabel: { ...type.bodyStrong, color: color.text },
  countdownTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  countdownFill: { height: 4, borderRadius: radius.pill },
  countdownNote: { ...type.caption, color: color.textMuted },

  actions: { flexDirection: "row", gap: space.md },

  endingRow: { flexDirection: "row", alignItems: "center", gap: space.md },

  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
  },
  triggerDot: { width: 10, height: 10, borderRadius: radius.pill },
  triggerTitle: { ...type.body, color: color.text },
  triggerSubtitle: { ...type.caption, color: color.textMuted, marginTop: 2, lineHeight: 17 },
});
