/**
 * The HUD's one job: readable at a glance, mid-conversation, under pressure.
 *
 * "Distinguishable without reading" is done with a glyph + shape + colour
 * triple, not colour alone: a hollow circle, a filled circle, a filled
 * triangle and a filled square are four shapes that stay distinct with the
 * colour desaturated (greyscale, or a colour-blind viewer) — the colour is
 * reinforcement, not the only channel. The word (NONE/LOW/ELEVATED/HIGH) is
 * printed too, but per the mobile-call-ui spec the band must already read
 * before anyone gets to the word.
 *
 * Never renders a numeric score before the first profile exists — a 0 there
 * would read as "assessed and safe", not "not assessed yet".
 */
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { RiskLevel, RiskProfile } from "../../../shared/src";
import { C, styles } from "../styles";

const BAND_META: Record<RiskLevel, { glyph: string; label: string; color: string; shape: "circle-hollow" | "circle" | "triangle" | "square" }> = {
  none: { glyph: "○", label: "NO SIGNS", color: C.none, shape: "circle-hollow" },
  low: { glyph: "●", label: "LOW", color: C.low, shape: "circle" },
  elevated: { glyph: "▲", label: "ELEVATED", color: C.elevated, shape: "triangle" },
  high: { glyph: "■", label: "HIGH RISK", color: C.high, shape: "square" },
};

export function RiskBand({
  profile,
  analysing,
  unavailable = false,
  ended = false,
}: {
  profile: RiskProfile | undefined;
  /** True once the call is running but no profile has landed yet. */
  analysing: boolean;
  unavailable?: boolean;
  ended?: boolean;
}) {
  if (!profile) {
    const title = ended
      ? "Analysis ended"
      : unavailable
        ? "Live analysis unavailable"
        : analysing
          ? "Waiting for analysis"
          : "Not started";
    const detail = ended || unavailable
      ? "Current risk and advice are hidden because live analysis is unavailable."
      : analysing
        ? "No assessment yet — this is not a score of zero, it's no data yet."
        : "Risk assessment appears once the call is running.";
    return (
      <View style={[localStyles.card, localStyles.pending]}>
        <ActivityIndicator size="small" color={C.faint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{title}</Text>
          <Text style={styles.small}>{detail}</Text>
        </View>
      </View>
    );
  }

  const meta = BAND_META[profile.risk];
  const showAdvice = (profile.risk === "elevated" || profile.risk === "high") && profile.advice.trim().length > 0;

  return (
    <View style={[localStyles.card, { borderColor: meta.color }]}>
      <View style={styles.row}>
        <BandGlyph shape={meta.shape} color={meta.color} />
        <View style={{ flex: 1 }}>
          <View style={styles.rowBetween}>
            <Text style={[localStyles.bandLabel, { color: meta.color }]}>{meta.label}</Text>
            <Text style={[localStyles.score, { color: meta.color }]}>{profile.score}</Text>
          </View>
          <Text style={styles.body}>{profile.headline}</Text>
        </View>
      </View>

      {showAdvice ? (
        <View style={[localStyles.advice, { borderColor: meta.color }]}>
          <Text style={localStyles.adviceLabel}>DO THIS NOW</Text>
          <Text style={localStyles.adviceText}>{profile.advice}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A plain RN View has no clip-path, so the triangle is built from RN's
 *  transparent-border trick and the square/circles from border-radius —
 *  the only geometry RN gives us for free without pulling in an SVG lib. */
function BandGlyph({ shape, color }: { shape: "circle-hollow" | "circle" | "triangle" | "square"; color: string }) {
  const size = 40;
  if (shape === "triangle") {
    return (
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size / 2,
          borderRightWidth: size / 2,
          borderBottomWidth: size * 0.86,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
    );
  }
  if (shape === "square") {
    return <View style={{ width: size * 0.82, height: size * 0.82, backgroundColor: color, borderRadius: 4 }} />;
  }
  if (shape === "circle") {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 4,
        borderColor: color,
        backgroundColor: "transparent",
      }}
    />
  );
}

const localStyles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  pending: { flexDirection: "row", alignItems: "center", gap: 12, borderColor: C.border },
  bandLabel: { fontSize: 15, fontWeight: "800", letterSpacing: 0.6 },
  score: { fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
  advice: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 4,
  },
  adviceLabel: { color: C.text, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  adviceText: { color: C.text, fontSize: 16, fontWeight: "700", lineHeight: 22 },
});
