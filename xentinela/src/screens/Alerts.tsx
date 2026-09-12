/**
 * The alerts, and a way to see each one.
 *
 * The Live tab raises these for real, from the analyzer. This screen stays
 * because a warning you can only see by waiting for a scam call is a warning
 * nobody can review: it puts all three on demand, on scripted content, so the
 * wording and the timing can be judged. It is a preview, and says so.
 */
import { StyleSheet, Text, View } from "react-native";
import { Screen, SectionLabel, TopBar } from "../ui";
import { color, space, type } from "../theme";
import { AlertTrigger } from "./CallAlert";

export function Alerts({ onBack }: { onBack: () => void }) {
  return (
    <Screen>
      <TopBar title="Alerts" subtitle="What a warning looks like" onBack={onBack} />

      <Text style={s.intro}>
        Calls happen in your phone's own dialer. Xentinela does not take them over — it watches
        along and draws the warning on top, so you see it without leaving the call.
      </Text>

      <SectionLabel>The three warnings</SectionLabel>
      <View style={s.list}>
        <AlertTrigger
          level="low"
          title="Low signal"
          subtitle="A strip at the top. The call carries on, and it closes itself."
        />
        <AlertTrigger
          level="elevated"
          title="Take care"
          subtitle="Covers the screen, names what to do, and leaves the choice to you."
        />
        <AlertTrigger
          level="high"
          title="High risk"
          subtitle="Takes the screen and hangs up after five seconds unless you stop it."
        />
      </View>

      <Text style={s.footnote}>
        There is no fourth warning. When a call looks ordinary nothing appears at all — that is
        what makes the other three worth reading.
      </Text>

      <SectionLabel>These three are previews</SectionLabel>
      <Text style={s.footnote}>
        They run on a scripted example, so the wording and the timing can be judged on demand
        rather than waited for. Each one writes a call into your activity when it finishes.
        The real thing is on the Live tab: the same three warnings, raised from what the
        analyzer found in an actual call, and a high one ends that call on its countdown.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: { ...type.body, color: color.textSecondary, lineHeight: 22 },
  list: { gap: space.sm },
  footnote: { ...type.caption, color: color.textMuted, lineHeight: 18, marginTop: space.sm },
});
