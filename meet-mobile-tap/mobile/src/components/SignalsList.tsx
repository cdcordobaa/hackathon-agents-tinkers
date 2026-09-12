/**
 * Evidence, not just a score. Per the mobile-call-ui spec: an empty signals
 * array renders nothing at all — no "no signals" box — because an empty box
 * still implies there's a concern-shaped thing to look at.
 */
import { StyleSheet, Text, View } from "react-native";
import type { Signal } from "../../../shared/src";
import { C, styles } from "../styles";

export function SignalsList({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.eyebrow}>Why</Text>
      {signals.map((signal, index) => (
        <SignalCard key={`${signal.type}-${index}`} signal={signal} />
      ))}
    </View>
  );
}

export function SignalCard({ signal }: { signal: Signal }) {
  return (
    <View style={[styles.card, local.card]}>
      <Text style={local.type}>{signal.type}</Text>
      <Text style={local.quote}>"{signal.quote}"</Text>
      <Text style={styles.body}>{signal.why}</Text>
    </View>
  );
}

const local = StyleSheet.create({
  card: { borderLeftWidth: 3, borderLeftColor: C.elevated },
  type: { color: C.elevated, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  quote: { color: C.text, fontSize: 15, fontStyle: "italic", lineHeight: 21 },
});
