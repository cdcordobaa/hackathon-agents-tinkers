/**
 * The call, in Xentinela's own language.
 *
 * The presentation now lives in `CallSurface`, which both this screen and the
 * rest of the shell share, so a LiveKit call and the scripted replay cannot
 * drift apart visually. What stays here is the part that is not presentation:
 *
 *   - the honesty gate. A profile is shown only while the connection is open
 *     and no speaker is degraded. A verdict that was true sixty seconds ago
 *     is not a verdict about now, and showing it as one is worse than showing
 *     nothing — the analyzer cannot have heard what nobody transcribed.
 *   - the assistant's two panels, both kept mounted and toggled by `display`
 *     rather than conditionally rendered, so its chat state and registered
 *     tools survive a tab switch.
 *
 * `livePanel` is whatever the transport wants above the band — for LiveKit,
 * the participants and the mic control.
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TranscriptSourceKind } from "../../../shared/src";
import type { GatewayState } from "../gateway/reducer";
import { CallSurface } from "./CallSurface";
import { CallAgentTools } from "../assistant/CallAgentTools";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { Screen } from "../ui";
import { color, space, type } from "../theme";
import { styles } from "../styles";

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
  const degraded = Object.keys(state.degraded).length > 0;
  const unavailable =
    state.connection === "reconnecting" || state.connection === "closed" || degraded;
  const currentProfile = state.connection === "open" && !degraded ? state.profile : undefined;

  // The gate, applied once here rather than trusted to every consumer below.
  const shown: GatewayState = { ...state, profile: currentProfile };

  return (
    <Screen>
      <Text style={local.eyebrow}>On a call · {transport}</Text>

      {livePanel}

      {unavailable && state.profile ? (
        <Text style={local.stale}>
          The last assessment is held back while the call cannot be heard properly. It described
          the call as it was, not as it is now.
        </Text>
      ) : null}

      <CallSurface state={shown} ending={ending} onEndCall={onEndCall} />

      {assistantEnabled ? (
        <>
          <View style={[styles.segment, local.segment]}>
            <SegmentButton
              label="Transcript"
              active={tab === "transcript"}
              onPress={() => setTab("transcript")}
            />
            <SegmentButton
              label="Assistant"
              active={tab === "assistant"}
              onPress={() => setTab("assistant")}
            />
          </View>
          <CallAgentTools
            profile={currentProfile}
            turns={state.turns}
            sessionState={state.sessionState}
          />
          <View style={tab !== "assistant" ? local.hidden : undefined}>
            <AssistantPanel />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  eyebrow: { ...type.eyebrow, color: color.accent, textTransform: "uppercase", marginBottom: space.md },
  segment: { marginTop: space.lg },
  stale: {
    ...type.caption,
    color: color.warning,
    lineHeight: 17,
    marginBottom: space.md,
  },
  hidden: { display: "none" },
});

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}
