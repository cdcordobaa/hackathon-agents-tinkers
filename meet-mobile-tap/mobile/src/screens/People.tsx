/**
 * The safety net. Scope for now is deliberately flat: one channel, one list,
 * everyone messaged together. No ordering, no escalation, no read state —
 * those need a guardian-side surface that does not exist yet.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Card, Row, Screen, SectionLabel, TopBar, styles as ui } from "../ui";
import { color, radius, space, type } from "../theme";
import { useStore } from "../store";

export function People({ onAddGuardian }: { onAddGuardian: () => void }) {
  const { guardians, dispatch } = useStore();

  return (
    <Screen>
      <TopBar title="People" subtitle="Who hears about a suspicious call" />

      <SectionLabel>Channel</SectionLabel>
      <Card>
        <Row
          first
          icon="paper-plane"
          iconColor={color.telegram}
          title="Telegram"
          subtitle="Connected"
          right={<Ionicons name="checkmark" size={20} color={color.accent} />}
        />
        <Row icon="logo-whatsapp" title="WhatsApp" muted />
      </Card>

      <SectionLabel>Guardians</SectionLabel>
      {guardians.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="person-add-outline" size={24} color={color.textMuted} />
          <Text style={s.emptyTitle}>No one is being alerted</Text>
          <Text style={s.emptyBody}>
            Add someone you trust. They get a message the moment a call looks like a scam.
          </Text>
        </View>
      ) : (
        <Card>
          {guardians.map((guardian, index) => (
            <Row
              key={guardian.id}
              first={index === 0}
              leading={<Avatar name={guardian.name} />}
              title={guardian.name}
              subtitle={`${guardian.relationship} · Telegram`}
              right={
                <Pressable
                  onPress={() => dispatch({ type: "removeGuardian", id: guardian.id })}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${guardian.name}`}
                  style={({ pressed }) => pressed && ui.pressed}
                >
                  <Ionicons name="remove-circle-outline" size={22} color={color.textMuted} />
                </Pressable>
              }
            />
          ))}
        </Card>
      )}

      <Pressable
        onPress={onAddGuardian}
        style={({ pressed }) => [s.add, pressed && ui.pressed]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={20} color={color.accent} />
        <Text style={s.addLabel}>Add guardian</Text>
      </Pressable>

      <Text style={s.footnote}>
        Every guardian is messaged at the same time. The alert says who called, when, and why it
        looked wrong — never a recording.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  empty: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: "center",
    gap: space.sm,
  },
  emptyTitle: { ...type.bodyStrong, color: color.text },
  emptyBody: { ...type.label, color: color.textMuted, textAlign: "center", lineHeight: 19 },

  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.lg,
  },
  addLabel: { ...type.body, color: color.accent, fontWeight: "600" },

  footnote: { ...type.caption, color: color.textMuted, lineHeight: 18 },
});
