import { StyleSheet } from "react-native";

/** Same dark palette the original App.tsx used, extended with risk-band
 *  colours. Kept in one place so the HUD, the assistant cards and the call
 *  screen chrome read as one app. */
export const C = {
  ground: "#0E1416",
  surface: "#1C262A",
  surfaceRaised: "#243035",
  border: "#35464C",
  text: "#E4EDEF",
  muted: "#93A6AC",
  faint: "#6F8188",
  accent: "#3FC6D1",
  accentStrong: "#7EDDE4",

  // Risk bands: colour is never the only signal — see RiskBand.tsx for the
  // shape/glyph each pairs with, so the band still reads correctly in
  // greyscale or for a colour-blind viewer.
  none: "#3FA66B",
  low: "#3FC6D1",
  elevated: "#F6B44B",
  high: "#E5484D",

  danger: "#E88B7D",
};

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ground },
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  scrollPage: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 14 },

  eyebrow: {
    color: C.accent,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  title: { color: C.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  subtitle: { color: C.text, fontSize: 18, fontWeight: "700" },
  body: { color: C.muted, fontSize: 15, lineHeight: 22 },
  small: { color: C.faint, fontSize: 12, lineHeight: 17 },
  code: {
    color: C.text,
    fontFamily: "Menlo",
    fontSize: 12,
    backgroundColor: C.surface,
    padding: 12,
    borderRadius: 4,
    overflow: "hidden",
  },

  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },

  banner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },

  primary: {
    backgroundColor: C.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryLabel: { color: "#06282B", fontSize: 15, fontWeight: "700" },
  primaryDisabled: { opacity: 0.4 },
  secondary: {
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryLabel: { color: C.text, fontSize: 15, fontWeight: "600" },
  destructive: { backgroundColor: C.danger },

  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipSelected: { borderColor: C.accent, backgroundColor: "#123539" },
  chipLabel: { color: C.text, fontSize: 14, fontWeight: "600" },

  segment: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center" },
  segmentItemActive: { backgroundColor: C.surfaceRaised },
  segmentLabel: { color: C.muted, fontSize: 13, fontWeight: "600" },
  segmentLabelActive: { color: C.text },

  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: C.text,
    backgroundColor: C.surface,
    fontSize: 15,
    fontFamily: "Menlo",
  },
});
