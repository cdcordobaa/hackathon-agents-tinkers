/**
 * Shared primitives. The one convention worth knowing: every component takes a
 * `muted` prop, and muted means *soft locked* — the control renders in grey and
 * stops responding. No lock glyph, no "coming soon" caption; the colour is the
 * whole message, so nothing has to be unsaid later when the feature lands.
 */
import type { ReactNode } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, space, type } from "./theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const androidInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 0;

export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  if (!scroll) {
    return <View style={styles.screen}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function TopBar({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <View style={[styles.topBar, { paddingTop: androidInset + space.md }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={color.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle}>{title}</Text>
        {subtitle ? <Text style={styles.topSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function SectionLabel({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text style={[styles.sectionLabel, muted && { color: color.muted }]}>{children}</Text>
  );
}

export function Card({
  children,
  style,
  tone = "surface",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "surface" | "flat";
}) {
  return (
    <View style={[tone === "flat" ? styles.cardFlat : styles.card, style]}>{children}</View>
  );
}

/**
 * The workhorse list row. `muted` greys everything and removes the press
 * handler, which is how a not-yet-built setting appears without a label
 * apologising for itself.
 */
export function Row({
  icon,
  iconColor,
  leading,
  title,
  subtitle,
  right,
  onPress,
  muted,
  danger,
  first,
}: {
  icon?: IconName;
  iconColor?: string;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  muted?: boolean;
  danger?: boolean;
  first?: boolean;
}) {
  const titleColor = muted ? color.muted : danger ? color.danger : color.text;
  const subColor = muted ? color.muted : color.textMuted;
  const resolvedIconColor = muted
    ? color.muted
    : iconColor ?? (danger ? color.danger : color.textSecondary);

  const body = (
    <>
      {leading ?? null}
      {icon ? (
        <Ionicons name={icon} size={20} color={resolvedIconColor} style={styles.rowIcon} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: titleColor }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: subColor }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right ?? null}
    </>
  );

  if (!onPress || muted) {
    return <View style={[styles.row, !first && styles.rowBorder]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !first && styles.rowBorder, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

export function Chevron({ muted, danger }: { muted?: boolean; danger?: boolean }) {
  return (
    <Ionicons
      name="chevron-forward"
      size={18}
      color={muted ? color.muted : danger ? color.danger : color.textMuted}
    />
  );
}

export function Toggle({
  value,
  onChange,
  muted,
  label,
}: {
  value: boolean;
  onChange?: () => void;
  muted?: boolean;
  label: string;
}) {
  const trackColor = muted
    ? color.mutedSurface
    : value
      ? color.accent
      : "rgba(255,255,255,0.12)";
  const knobColor = muted ? color.muted : value ? "#08130F" : color.textSecondary;

  const track = (
    <View
      style={[
        styles.track,
        { backgroundColor: trackColor },
        muted && { borderWidth: 1, borderColor: color.border },
      ]}
    >
      <View style={[styles.knob, { backgroundColor: knobColor }, value && styles.knobOn]} />
    </View>
  );

  if (muted || !onChange) return track;

  return (
    <Pressable
      onPress={onChange}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      {track}
    </Pressable>
  );
}

export function Pill({
  label,
  active,
  tone = "neutral",
  onPress,
}: {
  label: string;
  active?: boolean;
  tone?: "neutral" | "safe" | "flagged" | "blocked";
  onPress?: () => void;
}) {
  const toneColor =
    tone === "safe"
      ? color.accent
      : tone === "flagged"
        ? color.warning
        : tone === "blocked"
          ? color.danger
          : color.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.pill,
        active && { backgroundColor: toneColor, borderColor: toneColor },
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          { color: active ? "#08130F" : toneColor },
          active && { fontWeight: "600" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Dot({ tone }: { tone: string }) {
  return <View style={[styles.dot, { backgroundColor: tone }]} />;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "neutral",
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  tone?: "neutral" | "danger" | "accent";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const borderColor =
    tone === "danger" ? color.danger : tone === "accent" ? color.accent : color.borderStrong;
  const labelColor =
    tone === "danger" ? color.danger : tone === "accent" ? "#08130F" : color.text;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.button,
        { borderColor: disabled ? color.border : borderColor },
        tone === "accent" && !disabled && { backgroundColor: color.accent },
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: disabled ? color.muted : labelColor },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A slider that is only ever read, never dragged. Grey, and it does not move. */
export function MutedSlider({ fill }: { fill: number }) {
  return (
    <View style={styles.sliderTrack}>
      <View style={[styles.sliderFill, { width: `${fill * 100}%` }]} />
      <View style={[styles.sliderKnob, { left: `${fill * 100}%` }]} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  screenContent: { paddingHorizontal: space.lg, paddingBottom: space.xxl },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: space.lg,
    gap: space.sm,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -6,
  },
  topTitle: { ...type.display, color: color.text },
  topSubtitle: { ...type.label, color: color.textMuted, marginTop: 2 },

  sectionLabel: {
    ...type.eyebrow,
    color: color.textMuted,
    textTransform: "uppercase",
    marginTop: space.xl,
    marginBottom: space.sm,
  },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.lg,
  },
  cardFlat: {
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.lg,
    padding: space.lg,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md + 2,
    gap: space.md,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.border },
  rowIcon: { width: 22, textAlign: "center" },
  rowTitle: { ...type.body },
  rowSubtitle: { ...type.caption, marginTop: 2 },

  track: { width: 44, height: 26, borderRadius: radius.pill, padding: 3, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: radius.pill },
  knobOn: { alignSelf: "flex-end" },

  pill: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  pillLabel: { ...type.label },

  dot: { width: 8, height: 8, borderRadius: radius.pill },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: color.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...type.label, color: color.accent, fontWeight: "600" },

  button: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: "center",
  },
  buttonLabel: { ...type.bodyStrong },

  sliderTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.mutedSurface,
    justifyContent: "center",
  },
  sliderFill: { height: 6, borderRadius: radius.pill, backgroundColor: color.muted },
  sliderKnob: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: color.muted,
    marginLeft: -9,
  },

  pressed: { opacity: 0.6 },
});
