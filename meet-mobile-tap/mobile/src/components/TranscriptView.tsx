/**
 * Final turns only, speaker-labelled, in order — mirrors RollingTranscript's
 * own rule one level up (see shared/src/events.ts's TranscriptTurnEvent
 * comment): there is no wire event for in-progress speech, so there is
 * nothing here to accidentally render as final before it's stable.
 */
import { FlatList, StyleSheet, Text, View } from "react-native";
import type { TranscriptTurn } from "../gateway/reducer";
import { C, styles } from "../styles";

export function TranscriptView({ turns }: { turns: TranscriptTurn[] }) {
  if (turns.length === 0) {
    return (
      <View style={local.empty}>
        <Text style={styles.small}>Transcript appears here as turns finalise.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={turns}
      keyExtractor={(turn) => `${turn.seq}`}
      contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
      renderItem={({ item }) => (
        <View>
          <Text style={[local.speaker, item.role === "subject" ? local.you : local.caller]}>{item.speakerLabel}</Text>
          <Text style={styles.body}>{item.text}</Text>
        </View>
      )}
    />
  );
}

const local = StyleSheet.create({
  empty: { paddingVertical: 12 },
  speaker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2 },
  you: { color: C.accent },
  caller: { color: C.elevated },
});
