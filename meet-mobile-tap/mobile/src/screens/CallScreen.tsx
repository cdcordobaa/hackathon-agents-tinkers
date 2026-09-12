/**
 * The demo. Everything the mobile-call-ui spec asks for at once: the risk
 * band, advice when it matters, the evidence behind it, the live transcript,
 * and every degraded state visible rather than papered over.
 *
 * The End action stays fixed while the upper status and risk area can scroll
 * on compact phones. Both content panels remain mounted after the call starts
 * so assistant state survives tab switches.
 */
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TranscriptSourceKind } from "../../../shared/src";
import type { GatewayState } from "../gateway/reducer";
import { RiskBand } from "../components/RiskBand";
import { SignalsList } from "../components/SignalsList";
import { TranscriptView } from "../components/TranscriptView";
import { DegradedBanners } from "../components/DegradedBanners";
import { CallAgentTools } from "../assistant/CallAgentTools";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { C, styles } from "../styles";

type Tab = "transcript" | "assistant";

export function CallScreen({
  transport,
  state,
  livePanel,
  assistantEnabled,
  ending = false,
  onEndCall,
}: {
  transport: TranscriptSourceKind;
  state: GatewayState;
  livePanel?: ReactNode;
  assistantEnabled: boolean;
  ending?: boolean;
  onEndCall: () => void;
}) {
  const [tab, setTab] = useState<Tab>("transcript");
  const analysing = state.sessionState === "running" || state.sessionState === "ending";
  const degraded = Object.keys(state.degraded).length > 0;
  const unavailable = state.connection === "reconnecting" || state.connection === "closed" || degraded;
  const currentProfile = state.connection === "open" && !degraded ? state.profile : undefined;

  return (
    <View style={styles.page}>
      <View style={styles.rowBetween}>
        <Text style={styles.eyebrow}>On a call · {transport}</Text>
        <Pressable accessibilityRole="button" disabled={ending} onPress={onEndCall}>
          <Text style={[styles.eyebrow, { color: C.danger }]}>{ending ? "Ending…" : "End"}</Text>
        </Pressable>
      </View>

      <ScrollView style={local.upper} contentContainerStyle={local.upperContent} nestedScrollEnabled>
        <DegradedBanners connection={state.connection} backlogGap={state.backlogGap} degraded={state.degraded} />
        <RiskBand
          profile={currentProfile}
          analysing={analysing}
          unavailable={unavailable}
          ended={state.sessionState === "ended"}
        />
        {livePanel}
      </ScrollView>

      {assistantEnabled ? (
        <View style={styles.segment}>
          <SegmentButton label="Transcript" active={tab === "transcript"} onPress={() => setTab("transcript")} />
          <SegmentButton label="Assistant" active={tab === "assistant"} onPress={() => setTab("assistant")} />
        </View>
      ) : null}

      {assistantEnabled ? (
        <CallAgentTools profile={currentProfile} turns={state.turns} sessionState={state.sessionState} />
      ) : null}

      {/* Both panels stay mounted (display toggled, not conditionally
          rendered) so the assistant's chat state and registered tools
          survive switching tabs — see the file header. */}
      <View style={[{ flex: 1 }, assistantEnabled && tab !== "transcript" && local.hidden]}>
        {currentProfile ? <SignalsList signals={currentProfile.signals} /> : null}
        <TranscriptView turns={state.turns} />
      </View>

      {assistantEnabled ? (
        <View style={[{ flex: 1 }, tab !== "assistant" && local.hidden]}>
          <AssistantPanel />
        </View>
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  upper: { flexGrow: 0, maxHeight: "58%" },
  upperContent: { gap: 14, paddingBottom: 2 },
  hidden: { display: "none" },
});

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}
