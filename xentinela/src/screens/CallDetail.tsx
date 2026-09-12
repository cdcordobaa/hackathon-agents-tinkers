/**
 * One call, and why the app did what it did. The verdict banner, the signals
 * behind it, and the receipt of who was told — in that order, because the user
 * asks "what happened" before "who knows".
 */
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Screen, SectionLabel, TopBar } from "../ui";
import { color, radius, space, type, verdictColor, verdictTint } from "../theme";
import { formatDuration, useStore } from "../store";

const verdictCopy = {
  safe: { title: "No risk found", body: "Nothing in this call looked like a scam." },
  flagged: { title: "Flagged", body: "Some of this call matched known scam patterns." },
  blocked: { title: "Ended automatically", body: "The risk was immediate, so the call was cut." },
} as const;

export function CallDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { callById, guardians, guardianById, dispatch } = useStore();
  const call = callById(id);

  if (!call) {
    return (
      <Screen>
        <TopBar title="Call" onBack={onBack} />
        <Text style={s.missing}>This call is no longer in your history.</Text>
      </Screen>
    );
  }

  const tone = verdictColor[call.verdict];
  const copy = verdictCopy[call.verdict];
  const alerted = call.alerted.map(guardianById).filter(Boolean);

  return (
    <Screen>
      <TopBar title={call.caller} subtitle={`${call.day} ${call.time} · ${formatDuration(call.durationSec)}`} onBack={onBack} />

      <View style={[s.banner, { backgroundColor: verdictTint[call.verdict] }]}>
        <Ionicons
          name={
            call.verdict === "blocked"
              ? "close-circle"
              : call.verdict === "flagged"
                ? "alert-circle"
                : "checkmark-circle"
          }
          size={24}
          color={tone}
        />
        <View style={{ flex: 1 }}>
          <Text style={[s.bannerTitle, { color: tone }]}>{copy.title}</Text>
          <Text style={[s.bannerBody, { color: tone }]}>{copy.body}</Text>
        </View>
      </View>

      <SectionLabel>Number</SectionLabel>
      <Card>
        <View style={s.plainRow}>
          <Text style={s.plainLabel}>Called from</Text>
          <Text style={s.plainValue}>{call.number}</Text>
        </View>
        <View style={[s.plainRow, s.divided]}>
          <Text style={s.plainLabel}>Length</Text>
          <Text style={s.plainValue}>{formatDuration(call.durationSec)}</Text>
        </View>
        <View style={[s.plainRow, s.divided]}>
          <Text style={s.plainLabel}>Verdict</Text>
          <Text style={[s.plainValue, { color: tone }]}>{call.headline}</Text>
        </View>
      </Card>

      {call.signals.length > 0 ? (
        <>
          <SectionLabel>What was detected</SectionLabel>
          <View style={s.signals}>
            {call.signals.map((signal) => (
              <View key={signal} style={s.signal}>
                <Ionicons name="ellipse" size={6} color={tone} style={{ marginTop: 7 }} />
                <Text style={s.signalText}>{signal}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SectionLabel>Alert sent</SectionLabel>
      {alerted.length === 0 ? (
        <Card>
          <View style={s.plainRow}>
            <Text style={s.plainLabel}>No one was alerted about this call.</Text>
          </View>
        </Card>
      ) : (
        <Card>
          {alerted.map((guardian, index) => (
            <View key={guardian!.id} style={[s.alertRow, index > 0 && s.divided]}>
              <Ionicons name="paper-plane" size={18} color={color.telegram} />
              <View style={{ flex: 1 }}>
                <Text style={s.plainValue}>{guardian!.name}</Text>
                <Text style={s.plainLabel}>{guardian!.relationship} · Telegram</Text>
              </View>
              <Text style={s.sentAt}>{call.time}</Text>
            </View>
          ))}
        </Card>
      )}
      {alerted.length > 1 ? (
        <Text style={s.footnote}>All {alerted.length} were messaged at the same time.</Text>
      ) : null}

      {call.reported ? (
        <View style={s.reported}>
          <Ionicons name="flag" size={16} color={color.textSecondary} />
          <Text style={s.reportedText}>You reported this number.</Text>
        </View>
      ) : null}

      <View style={s.actions}>
        <Button
          label="Mark safe"
          onPress={() => dispatch({ type: "markSafe", id: call.id })}
          disabled={call.verdict === "safe"}
        />
        <Button
          label={call.reported ? "Reported" : "Report"}
          tone="danger"
          onPress={() => dispatch({ type: "report", id: call.id })}
          disabled={call.reported}
        />
      </View>
      <Text style={s.footnote}>
        Marking a call safe teaches the model. It does not undo an alert that was already sent.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  missing: { ...type.body, color: color.textMuted },

  banner: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "flex-start",
    borderRadius: radius.lg,
    padding: space.lg,
  },
  bannerTitle: { ...type.heading },
  bannerBody: { ...type.label, marginTop: 3, lineHeight: 19 },

  plainRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: space.md },
  divided: { borderTopWidth: 1, borderTopColor: color.border },
  plainLabel: { ...type.label, color: color.textMuted },
  plainValue: { ...type.body, color: color.text },

  signals: { gap: space.sm },
  signal: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "flex-start",
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  signalText: { ...type.body, color: color.text, flex: 1, lineHeight: 21 },

  alertRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  sentAt: { ...type.caption, color: color.textMuted },

  reported: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.lg,
  },
  reportedText: { ...type.label, color: color.textSecondary },

  actions: { flexDirection: "row", gap: space.md, marginTop: space.xl },
  footnote: { ...type.caption, color: color.textMuted, marginTop: space.md, lineHeight: 17 },
});
