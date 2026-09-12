/**
 * The demo. Everything the mobile-call-ui spec asks for at once: the risk
 * band, advice when it matters, the evidence behind it, the live transcript,
 * and every degraded state visible rather than papered over.
 *
 * Layout is fixed top (HUD, advice, banners) then a segmented Transcript /
 * Assistant area — the HUD never scrolls out of view, per
 * add-copilot-fraud-assistant's "the HUD is primary and always visible."
 * Both panels stay mounted once the call starts (toggled with `hidden`, not
 * unmounted) so the assistant's chat history and registered tools survive
 * switching tabs.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TranscriptSourceKind } from "../../../shared/src";
import type { GatewayState } from "../gateway/reducer";
import { RiskBand } from "../components/RiskBand";
import { SignalsList } from "../components/SignalsList";
import { TranscriptView } from "../components/TranscriptView";
import { DegradedBanners } from "../components/DegradedBanners";
import { LiveKitCallPanel } from "../livekit/LiveKitCallPanel";
import { CallAgentTools } from "../assistant/CallAgentTools";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { C, styles } from "../styles";

type Tab = "transcript" | "assistant";

export function CallScreen({
  transport,
  state,
  onEndCall,
  consentRecordedElsewhere = false,
}: {
  transport: TranscriptSourceKind;
  state: GatewayState;
  onEndCall: () => void;
  /** True only when this phone joined a session that had already passed the
   *  consent gate before it got here — never true for a session this phone
   *  itself granted consent on. Rendered as a visible line, not a silent
   *  skip: per the consent gate's own requirement, "the session was
   *  consented to" and "consent was never asked" must never look the same
   *  from this screen. */
  consentRecordedElsewhere?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("transcript");
  const analysing = state.sessionState === "running" || state.sessionState === "ending";

  return (
    <View style={styles.page}>
      <View style={styles.rowBetween}>
        <Text style={styles.eyebrow}>On a call · {transport}</Text>
        <Pressable onPress={onEndCall}>
          <Text style={[styles.eyebrow, { color: C.danger }]}>End</Text>
        </Pressable>
      </View>

      {consentRecordedElsewhere ? (
        <Text style={styles.small}>
          Consent for this session was already granted before this phone joined — recorded, not
          skipped.
        </Text>
      ) : null}

      <DegradedBanners connection={state.connection} backlogGap={state.backlogGap} degraded={state.degraded} />

      <RiskBand profile={state.profile} analysing={analysing} />

      {transport === "livekit" ? <LiveKitCallPanel /> : null}

      <View style={styles.segment}>
        <SegmentButton label="Transcript" active={tab === "transcript"} onPress={() => setTab("transcript")} />
        <SegmentButton label="Assistant" active={tab === "assistant"} onPress={() => setTab("assistant")} />
      </View>

      <CallAgentTools profile={state.profile} turns={state.turns} sessionState={state.sessionState} />

      {/* Both panels stay mounted (display toggled, not conditionally
          rendered) so the assistant's chat state and registered tools
          survive switching tabs — see the file header. */}
      <View style={[{ flex: 1 }, tab !== "transcript" && local.hidden]}>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
          {state.profile ? <SignalsList signals={state.profile.signals} /> : null}
          <TranscriptView turns={state.turns} />
        </ScrollView>
      </View>

      <View style={[{ flex: 1 }, tab !== "assistant" && local.hidden]}>
        <AssistantPanel />
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  hidden: { display: "none" },
});

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}
