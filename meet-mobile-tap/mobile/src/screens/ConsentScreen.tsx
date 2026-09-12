import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { C, styles } from "../styles";
import type { MobileTransport } from "./SetupScreen";

export function ConsentScreen({
  ready,
  busy,
  transport,
  error,
  onGrant,
  onDecline,
}: {
  ready: boolean;
  busy: boolean;
  transport: MobileTransport;
  error: string | undefined;
  onGrant: () => void;
  onDecline: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const canStart = ready && confirmed && !busy;

  return (
    <ScrollView contentContainerStyle={styles.scrollPage}>
      <Text style={styles.eyebrow}>{transport === "livekit" ? "Before joining the room" : "Before the replay starts"}</Text>
      <Text style={styles.title}>{transport === "livekit" ? "Consent to live analysis" : "Run the scripted sample"}</Text>

      <View style={styles.card}>
        {transport === "livekit" ? (
          <>
            <Text style={styles.body}>
              Audio in this room will be transcribed and analysed for social-engineering and
              fraud risk during the call. The transcript and risk guidance appear on screen.
            </Text>
            <Text style={styles.body}>
              Make sure everyone on the call agrees before you join the room.
            </Text>
          </>
        ) : (
          <Text style={styles.body}>
            Replay uses a scripted bank-scam sample to demonstrate the transcript and risk
            experience. It does not use your microphone.
          </Text>
        )}
      </View>

      {error ? (
        <View style={[styles.banner, { borderColor: C.danger, backgroundColor: "#1C262A" }]}>
          <Text style={[styles.bannerText, { color: C.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => setConfirmed((current) => !current)}
        style={local.consentRow}
      >
        <View style={[local.checkbox, confirmed && local.checkboxChecked]}>
          <Text style={local.checkmark}>{confirmed ? "✓" : ""}</Text>
        </View>
        <Text style={[styles.body, local.consentText]}>
          {transport === "livekit"
            ? "Everyone agrees to audio being transcribed and analysed during this call."
            : "I understand this is a scripted sample and want to continue."}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={[styles.primary, !canStart && styles.primaryDisabled]}
        onPress={onGrant}
        disabled={!canStart}
      >
        {canStart ? (
          <Text style={styles.primaryLabel}>Start the call</Text>
        ) : ready && !busy ? (
          <Text style={styles.primaryLabel}>Confirm consent to continue</Text>
        ) : (
          <View style={styles.row}>
            <ActivityIndicator color="#06282B" />
            <Text style={styles.primaryLabel}>{busy ? "Connecting the call…" : "Connecting to session…"}</Text>
          </View>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={onDecline}>
        <Text style={styles.secondaryLabel}>Decline — don't start</Text>
      </Pressable>
    </ScrollView>
  );
}

const local = {
  consentRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12 },
  consentText: { flex: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.faint,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  checkboxChecked: { borderColor: C.accent, backgroundColor: C.accent },
  checkmark: { color: "#06282B", fontSize: 16, fontWeight: "800" as const, lineHeight: 19 },
};
