import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { C, styles } from "../styles";

export type MobileTransport = "livekit" | "replay";
export type CallRole = "subject" | "counterparty";

const TRANSPORTS: { kind: MobileTransport; label: string; description: string }[] = [
  {
    kind: "livekit",
    label: "LiveKit room",
    description: "Join a real WebRTC call from this phone with live transcript and risk monitoring.",
  },
  {
    kind: "replay",
    label: "Replay",
    description: "Run the scripted bank-scam call through the event gateway without using a microphone.",
  },
];

export function SetupScreen({
  selected,
  gatewayUrl,
  roomName,
  displayName,
  role,
  error,
  onSelect,
  onGatewayUrl,
  onRoomName,
  onDisplayName,
  onRole,
  onContinue,
}: {
  selected: MobileTransport;
  gatewayUrl: string;
  roomName: string;
  displayName: string;
  role: CallRole;
  error?: string;
  onSelect: (kind: MobileTransport) => void;
  onGatewayUrl: (value: string) => void;
  onRoomName: (value: string) => void;
  onDisplayName: (value: string) => void;
  onRole: (value: CallRole) => void;
  onContinue: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollPage} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>SecureGuIA</Text>
      <Text style={styles.title}>Start a monitored call</Text>
      <Text style={styles.body}>
        Join the same LiveKit room as the other caller and see risk signals tied to what was
        actually said.
      </Text>

      <Text style={[styles.eyebrow, { marginTop: 8 }]}>Call path</Text>
      <View style={{ gap: 10 }}>
        {TRANSPORTS.map((transport) => {
          const active = transport.kind === selected;
          return (
            <Pressable
              key={transport.kind}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(transport.kind)}
              style={[styles.card, active && { borderColor: C.accent }]}
            >
              <View style={styles.rowBetween}>
                <Text style={styles.subtitle}>{transport.label}</Text>
                <View style={[styles.chip, active && styles.chipSelected]}>
                  <Text style={styles.chipLabel}>{active ? "Selected" : "Select"}</Text>
                </View>
              </View>
              <Text style={styles.body}>{transport.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Field
        label="Gateway URL"
        value={gatewayUrl}
        onChangeText={onGatewayUrl}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="http://localhost:8787"
        hint="Use your computer’s LAN address on a physical phone."
      />

      {selected === "livekit" ? (
        <>
          <Field
            label="Room"
            value={roomName}
            onChangeText={onRoomName}
            autoCapitalize="none"
            placeholder="demo"
          />
          <Field
            label="Display name"
            value={displayName}
            onChangeText={onDisplayName}
            autoCapitalize="words"
            placeholder="Your name"
          />
          <View style={{ gap: 7 }}>
            <Text style={local.label}>Your role</Text>
            <View accessibilityRole="radiogroup" style={styles.segment}>
              <RoleButton label="Protected person" active={role === "subject"} onPress={() => onRole("subject")} />
              <RoleButton label="Other caller" active={role === "counterparty"} onPress={() => onRole("counterparty")} />
            </View>
          </View>
        </>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={[styles.banner, { borderColor: C.danger }]}>
          <Text style={[styles.bannerText, { color: C.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" style={[styles.primary, { marginTop: 8 }]} onPress={onContinue}>
        <Text style={styles.primaryLabel}>Continue</Text>
      </Pressable>
      <Text style={styles.small}>Twilio calling is not available in this build.</Text>
    </ScrollView>
  );
}

function Field({ label, hint, ...props }: React.ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={local.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={C.faint}
        selectionColor={C.accent}
        style={local.input}
      />
      {hint ? <Text style={styles.small}>{hint}</Text> : null}
    </View>
  );
}

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segmentItem, active && styles.segmentItemActive]}
    >
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const local = {
  label: { color: C.text, fontSize: 14, fontWeight: "600" as const },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: C.surface,
    color: C.text,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
  },
};
