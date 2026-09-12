/**
 * Only two things here actually move: protection, and the way into privacy.
 * The rest is grey — present so the shape of the product is legible, inert
 * because the logic behind it is not built.
 */
import { StyleSheet, Text, View } from "react-native";
import { Card, Chevron, MutedSlider, Row, Screen, SectionLabel, Toggle, TopBar } from "../ui";
import { color, space, type } from "../theme";
import { useStore } from "../store";

export function Settings({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  const { protectionOn, dispatch } = useStore();

  return (
    <Screen>
      <TopBar title="Settings" />

      <Card>
        <Row
          first
          title="Protection"
          subtitle="Analyse incoming calls"
          right={
            <Toggle
              value={protectionOn}
              onChange={() => dispatch({ type: "toggleProtection" })}
              label="Protection"
            />
          }
        />
      </Card>

      <SectionLabel muted>Sensitivity</SectionLabel>
      <View style={s.slider}>
        <MutedSlider fill={0.6} />
        <View style={s.sliderLabels}>
          <Text style={s.sliderEnd}>Relaxed</Text>
          <Text style={s.sliderEnd}>Strict</Text>
        </View>
      </View>

      <SectionLabel>Rules</SectionLabel>
      <Card>
        <Row
          first
          icon="call-outline"
          title="End critical calls"
          muted
          right={<Toggle value muted label="End critical calls" />}
        />
        <Row
          icon="person-outline"
          title="Skip known contacts"
          muted
          right={<Toggle value={false} muted label="Skip known contacts" />}
        />
        <Row icon="language-outline" title="Language" muted right={<Text style={s.value}>English</Text>} />
      </Card>

      <SectionLabel>Data</SectionLabel>
      <Card>
        <Row
          first
          icon="lock-closed-outline"
          title="Privacy and data"
          onPress={onOpenPrivacy}
          right={<Chevron />}
        />
      </Card>

      <Text style={s.version}>Centinela · demo build</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  slider: { paddingHorizontal: space.xs },
  sliderLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: space.md },
  sliderEnd: { ...type.caption, color: color.muted },
  value: { ...type.label, color: color.muted },
  version: { ...type.caption, color: color.textMuted, textAlign: "center", marginTop: space.xxl },
});
