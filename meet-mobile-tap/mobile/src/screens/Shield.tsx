/**
 * Home. One question answered in one glance: is it on?
 * Everything below the status card is evidence that it has been working.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Row, Screen, SectionLabel, Toggle, TopBar, styles as ui } from "../ui";
import { color, radius, space, type, verdictColor } from "../theme";
import { useStore } from "../store";

export function Shield({
  onOpenCall,
  onOpenActivity,
  onOpenPeople,
}: {
  onOpenCall: (id: string) => void;
  onOpenActivity: () => void;
  onOpenPeople: () => void;
}) {
  const { protectionOn, calls, guardians, stats, dispatch } = useStore();
  const recent = calls.slice(0, 3);

  return (
    <Screen>
      <TopBar title="Xentinela" subtitle="Call protection" />

      <View
        style={[
          s.hero,
          {
            backgroundColor: protectionOn ? color.accentTint : color.surface,
            borderColor: protectionOn ? "transparent" : color.border,
          },
        ]}
      >
        <View
          style={[
            s.heroBadge,
            { backgroundColor: protectionOn ? color.accent : "rgba(255,255,255,0.06)" },
          ]}
        >
          <Ionicons
            name={protectionOn ? "shield-checkmark" : "shield-outline"}
            size={26}
            color={protectionOn ? "#08130F" : color.textMuted}
          />
        </View>
        <Text style={[s.heroTitle, { color: protectionOn ? color.accent : color.textSecondary }]}>
          {protectionOn ? "Protected" : "Paused"}
        </Text>
        <Text style={[s.heroBody, { color: protectionOn ? color.accent : color.textMuted }]}>
          {protectionOn
            ? "Listening on every call"
            : "No calls are being analysed right now"}
        </Text>
        <View style={s.heroToggle}>
          <Toggle
            value={protectionOn}
            onChange={() => dispatch({ type: "toggleProtection" })}
            label="Protection"
          />
        </View>
      </View>

      <View style={s.stats}>
        <Stat value={stats.total} label="calls" tone={color.text} />
        <Stat value={stats.flagged} label="flagged" tone={verdictColor.flagged} />
        <Stat value={stats.blocked} label="blocked" tone={verdictColor.blocked} />
      </View>

      <SectionLabel>Recent</SectionLabel>
      <Card>
        {recent.map((call, index) => (
          <Row
            key={call.id}
            first={index === 0}
            icon={
              call.verdict === "blocked"
                ? "call-outline"
                : call.verdict === "flagged"
                  ? "alert-circle-outline"
                  : "checkmark-circle-outline"
            }
            iconColor={verdictColor[call.verdict]}
            title={call.caller}
            subtitle={`${call.headline} · ${call.day} ${call.time}`}
            onPress={() => onOpenCall(call.id)}
            right={<Ionicons name="chevron-forward" size={18} color={color.textMuted} />}
          />
        ))}
      </Card>

      <Pressable
        onPress={onOpenActivity}
        style={({ pressed }) => [s.link, pressed && ui.pressed]}
        accessibilityRole="button"
      >
        <Text style={s.linkLabel}>See all activity</Text>
        <Ionicons name="arrow-forward" size={16} color={color.accent} />
      </Pressable>

      <SectionLabel>Who gets alerted</SectionLabel>
      <Pressable
        onPress={onOpenPeople}
        style={({ pressed }) => [s.guardianStrip, pressed && ui.pressed]}
        accessibilityRole="button"
      >
        <Ionicons name="people-outline" size={20} color={color.textSecondary} />
        <Text style={s.guardianText}>
          {guardians.length === 0
            ? "No one yet"
            : guardians.length === 1
              ? `${guardians[0].name}`
              : `${guardians[0].name} and ${guardians.length - 1} more`}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
      </Pressable>
      <Text style={s.footnote}>
        Everyone on the list is messaged at the same time, on Telegram.
      </Text>
    </Screen>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color: tone }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: "center",
  },
  heroBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { ...type.title, marginTop: space.md },
  heroBody: { ...type.label, marginTop: 4, textAlign: "center" },
  heroToggle: { marginTop: space.lg },

  stats: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  stat: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "600" },
  statLabel: { ...type.caption, color: color.textMuted, marginTop: 2 },

  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  linkLabel: { ...type.label, color: color.accent, fontWeight: "600" },

  guardianStrip: {
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
  guardianText: { ...type.body, color: color.text, flex: 1 },
  footnote: { ...type.caption, color: color.textMuted, marginTop: space.sm, lineHeight: 17 },
});
