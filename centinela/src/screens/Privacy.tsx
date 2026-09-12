/**
 * Four questions a listening app has to answer out loud: what happens to the
 * audio, what is kept and for how long, what the alert actually contains, and
 * how much is sitting on the phone. The answers are readable; the actions
 * underneath them are soft locked until there is a backend to honour them.
 */
import { StyleSheet, Text, View } from "react-native";
import { Card, Chevron, Row, Screen, SectionLabel, TopBar } from "../ui";
import { color, radius, space, type } from "../theme";

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <Screen>
      <TopBar title="Privacy and data" onBack={onBack} />

      <SectionLabel>What happens to your calls</SectionLabel>
      <Card>
        <Row
          first
          icon="pulse-outline"
          title="Audio"
          subtitle="Analysed as it happens, never recorded"
        />
        <Row
          icon="document-text-outline"
          title="Transcripts"
          subtitle="Flagged calls only, kept 30 days"
        />
        <Row
          icon="paper-plane-outline"
          title="Alerts contain"
          subtitle="Number, time and reason. No audio"
        />
        <Row
          icon="phone-portrait-outline"
          title="Stored on this phone"
          subtitle="1.2 MB of call history"
        />
      </Card>

      <View style={s.notice}>
        <Text style={s.noticeText}>
          Recording rules differ by country. Callers are told the line is monitored.
        </Text>
      </View>

      <SectionLabel>Your data</SectionLabel>
      <Card>
        <Row first icon="download-outline" title="Export my history" muted right={<Chevron muted />} />
        <Row icon="trash-outline" title="Delete everything" muted right={<Chevron muted />} />
        <Row icon="open-outline" title="Privacy policy" muted right={<Chevron muted />} />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  notice: {
    backgroundColor: color.warningTint,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
  },
  noticeText: { ...type.label, color: color.warning, lineHeight: 19 },
});
