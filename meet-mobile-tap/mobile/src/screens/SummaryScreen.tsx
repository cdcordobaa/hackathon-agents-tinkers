/**
 * Post-call outcome. No case-file link — case files are explicitly
 * out of scope for this build (see this task's brief); this shows what the
 * session itself produced and offers to start another one.
 */
import { Pressable, ScrollView, Text, View } from "react-native";
import type { GatewayState } from "../gateway/reducer";
import { SignalsList } from "../components/SignalsList";
import { styles } from "../styles";

export function SummaryScreen({ state, onStartNew }: { state: GatewayState; onStartNew: () => void }) {
  const peak = state.peak;

  return (
    <ScrollView contentContainerStyle={styles.scrollPage}>
      <Text style={styles.eyebrow}>Call ended</Text>
      <Text style={styles.title}>Session summary</Text>

      <View style={styles.card}>
        {peak ? (
          <>
            <Text style={styles.subtitle}>
              Highest observed risk: {peak.risk.toUpperCase()} ({peak.score})
            </Text>
            <Text style={styles.body}>{peak.headline}</Text>
          </>
        ) : (
          <Text style={styles.body}>No assessment was received during this call.</Text>
        )}
      </View>

      {peak && peak.signals.length > 0 ? <SignalsList signals={peak.signals} /> : null}

      <Text style={[styles.eyebrow, { marginTop: 8 }]}>Transcript ({state.turns.length} turns)</Text>
      <View style={styles.card}>
        {state.turns.length === 0 ? (
          <Text style={styles.body}>No transcript turns were received.</Text>
        ) : (
          state.turns.slice(-5).map((t) => (
            <View key={t.seq} style={{ marginBottom: 6 }}>
              <Text style={styles.small}>{t.speakerLabel}</Text>
              <Text style={styles.body}>{t.text}</Text>
            </View>
          ))
        )}
        {state.turns.length > 5 ? <Text style={styles.small}>…and {state.turns.length - 5} earlier turns.</Text> : null}
      </View>

      <Pressable style={[styles.primary, { marginTop: 8 }]} onPress={onStartNew}>
        <Text style={styles.primaryLabel}>Start a new session</Text>
      </Pressable>
    </ScrollView>
  );
}
