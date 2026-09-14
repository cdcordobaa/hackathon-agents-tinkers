import { StyleSheet } from "react-native";

/**
 * The Xentinela design system, as this build needs it.
 *
 * The source of truth is `xentinela/src/theme.ts` and `xentinela/src/ui.tsx`.
 * The values are restated here rather than imported for the same reason the
 * wire types are: Metro only watches this project's own root, and reaching
 * across to a sibling package is exactly the kind of build configuration that
 * costs us a working build. Keep this in step with those two; it is a copy,
 * and a copy drifts if nobody looks.
 *
 * Every name this file used to export still exists and still means the same
 * thing, so no screen had to change to pick the new look up. What changed is
 * underneath: the palette, the type scale, the radii and the spacing step.
 *
 * The one rule worth keeping: colour carries exactly one meaning in this app,
 * and that meaning is risk. Teal is the resting state, amber is a soft signal,
 * red is a verdict. Nothing decorative borrows those three.
 */

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const C = {
  ground: "#0A0E0D",
  surface: "#121817",
  surfaceRaised: "#1A2220",
  border: "rgba(255,255,255,0.07)",
  text: "#EDF2F0",
  muted: "#97A5A1",
  faint: "#6A7874",
  accent: "#3ED6A5",
  accentStrong: "#6FE3BC",

  // Risk bands. `RiskBand.tsx` pairs each with a shape and a glyph, so the
  // band still reads correctly in greyscale or for a colour-blind viewer —
  // colour is never the only signal.
  none: "#3ED6A5",
  low: "#F0B44C",
  // Between amber and red on purpose: `elevated` asks for a decision without
  // having made one, and either neighbour's colour would misstate that.
  elevated: "#FF9A5A",
  high: "#FF6F60",

  danger: "#FF6F60",
} as const;

/** Border that has to be seen rather than felt — a focused chip, a button. */
const borderStrong = "rgba(255,255,255,0.16)";

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ground },
  page: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    gap: space.md,
  },
  scrollPage: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },

  eyebrow: {
    color: C.accent,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  title: { color: C.text, fontSize: 28, fontWeight: "600", letterSpacing: -0.4 },
  subtitle: { color: C.text, fontSize: 17, fontWeight: "600" },
  body: { color: C.muted, fontSize: 15, lineHeight: 22 },
  small: { color: C.faint, fontSize: 12, lineHeight: 17 },
  code: {
    color: C.text,
    fontFamily: "Menlo",
    fontSize: 12,
    backgroundColor: C.surfaceRaised,
    padding: space.md,
    borderRadius: radius.sm,
    overflow: "hidden",
  },

  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },

  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },

  // Dark ink on teal, the one place a near-black text colour is correct.
  primary: {
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.accent,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryLabel: { color: "#08130F", fontSize: 15, fontWeight: "600" },
  primaryDisabled: { opacity: 0.4 },
  secondary: {
    borderWidth: 1,
    borderColor: borderStrong,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: "center",
  },
  secondaryLabel: { color: C.text, fontSize: 15, fontWeight: "600" },
  destructive: { backgroundColor: "transparent", borderColor: C.danger },

  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  chip: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  chipSelected: { borderColor: C.accent, backgroundColor: "rgba(62,214,165,0.13)" },
  chipLabel: { color: C.text, fontSize: 13, fontWeight: "400" },

  segment: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentItem: { flex: 1, paddingVertical: space.sm, borderRadius: radius.sm, alignItems: "center" },
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
