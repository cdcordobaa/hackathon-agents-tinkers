/**
 * Choose a call path, then move to consent. Nothing here connects anything —
 * the gateway socket does not open until session.start is sent, right after
 * consent is granted, so a user can sit on this screen indefinitely with no
 * audio processed and no session created.
 *
 * The full mobile-call-ui spec asks for the gateway to advertise which
 * transports are actually available so an unavailable one is never offered.
 * shared/'s event protocol has no such event in this pass (see
 * shared/src/events.ts — session.state reports the transport a session
 * already runs on, not which ones exist to pick from), so this is a static
 * list of the three kinds shared/ defines. Wiring live availability is
 * gateway work, not something the client can fabricate honestly.
 */
import { Pressable, ScrollView, Text, View } from "react-native";
import type { TranscriptSourceKind } from "../../../shared/src";
import { styles } from "../styles";

const TRANSPORTS: { kind: TranscriptSourceKind; label: string; description: string }[] = [
  {
    kind: "replay",
    label: "Replay",
    description: "A scripted bank-scam call through the real pipeline. No phone number, no LiveKit account — the safe default for a demo.",
  },
  {
    kind: "twilio",
    label: "Twilio",
    description: "A real phone call. Twilio transcribes it server-side and posts segments to the gateway.",
  },
  {
    kind: "livekit",
    label: "LiveKit",
    description: "Join a WebRTC room from this phone. Call-only in this build — no transcript or risk analysis on this path yet.",
  },
];

export function SetupScreen({
  selected,
  onSelect,
  onContinue,
}: {
  selected: TranscriptSourceKind;
  onSelect: (kind: TranscriptSourceKind) => void;
  onContinue: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollPage}>
      <Text style={styles.eyebrow}>SecureGuIA</Text>
      <Text style={styles.title}>Start a monitored call</Text>
      <Text style={styles.body}>
        Watches a live call and flags social-engineering as it happens — a risk score you can
        check against what was actually said, not a black box.
      </Text>

      <Text style={[styles.eyebrow, { marginTop: 8 }]}>Call path</Text>
      <View style={{ gap: 10 }}>
        {TRANSPORTS.map((t) => {
          const isSelected = t.kind === selected;
          return (
            <Pressable
              key={t.kind}
              onPress={() => onSelect(t.kind)}
              style={[styles.card, isSelected && { borderColor: "#3FC6D1" }]}
            >
              <View style={styles.rowBetween}>
                <Text style={styles.subtitle}>{t.label}</Text>
                <View style={[styles.chip, isSelected && styles.chipSelected]}>
                  <Text style={styles.chipLabel}>{isSelected ? "Selected" : "Select"}</Text>
                </View>
              </View>
              <Text style={styles.body}>{t.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={[styles.primary, { marginTop: 8 }]} onPress={onContinue}>
        <Text style={styles.primaryLabel}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}
