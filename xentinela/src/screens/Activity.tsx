/**
 * The record. Filters are real, grouping follows the day label on each record,
 * and every row pushes its detail.
 */
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Dot, Pill, Row, Screen, TopBar } from "../ui";
import { color, radius, space, type, verdictColor } from "../theme";
import { formatDuration, useStore, type Verdict } from "../store";

type Filter = "all" | Verdict;

const filters: { key: Filter; label: string; tone: "neutral" | "safe" | "flagged" | "blocked" }[] = [
  { key: "all", label: "All", tone: "neutral" },
  { key: "safe", label: "Safe", tone: "safe" },
  { key: "flagged", label: "Flagged", tone: "flagged" },
  { key: "blocked", label: "Blocked", tone: "blocked" },
];

export function Activity({ onOpenCall }: { onOpenCall: (id: string) => void }) {
  const { calls } = useStore();
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const visible = filter === "all" ? calls : calls.filter((call) => call.verdict === filter);
    const byDay = new Map<string, typeof visible>();
    for (const call of visible) {
      byDay.set(call.day, [...(byDay.get(call.day) ?? []), call]);
    }
    return [...byDay.entries()];
  }, [calls, filter]);

  return (
    <Screen>
      <TopBar title="Activity" subtitle={`${calls.length} calls analysed`} />

      <View style={s.filters}>
        {filters.map((entry) => (
          <Pill
            key={entry.key}
            label={entry.label}
            tone={entry.tone}
            active={filter === entry.key}
            onPress={() => setFilter(entry.key)}
          />
        ))}
      </View>

      {groups.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="funnel-outline" size={22} color={color.textMuted} />
          <Text style={s.emptyText}>Nothing matches this filter.</Text>
        </View>
      ) : null}

      {groups.map(([day, dayCalls]) => (
        <View key={day}>
          <Text style={s.day}>{day}</Text>
          <Card>
            {dayCalls.map((call, index) => (
              <Row
                key={call.id}
                first={index === 0}
                title={call.caller}
                subtitle={`${formatDuration(call.durationSec)} · ${call.headline.toLowerCase()}`}
                onPress={() => onOpenCall(call.id)}
                leading={<Dot tone={verdictColor[call.verdict]} />}
                right={
                  <View style={s.right}>
                    <Text style={s.time}>{call.time}</Text>
                    <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
                  </View>
                }
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  filters: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  day: {
    ...type.caption,
    color: color.textMuted,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  right: { flexDirection: "row", alignItems: "center", gap: space.sm },
  time: { ...type.caption, color: color.textMuted },
  empty: {
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xxl,
    marginTop: space.lg,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
  },
  emptyText: { ...type.label, color: color.textMuted },
});
