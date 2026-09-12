/**
 * A call being analysed right now, in Xentinela's own language.
 *
 * This is the presentation half of the old CallScreen, rewritten against the
 * shell's primitives so a real LiveKit call and the scripted replay look like
 * the same product. It renders `GatewayState` and nothing else: the transcript
 * is what the transport heard and the risk band is the analyzer's latest pass,
 * never a local guess.
 *
 * It owns no session. Starting, consenting and ending all belong to LiveTab,
 * which holds the socket and the room.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, SectionLabel } from "../ui";
import { color, radius, space, type, verdictColor, verdictTint } from "../theme";
import type { GatewayState } from "../gateway/reducer";
import type { RiskProfile } from "../../../shared/src";

/** Xentinela speaks in verdicts, the analyzer in risk levels. One mapping. */
export function verdictFor(risk: RiskProfile["risk"] | undefined): "safe" | "flagged" | "blocked" {
  if (risk === "high") return "blocked";
  if (risk === "elevated") return "flagged";
  return "safe";
}

export function CallSurface({
  state,
  ending,
  onEndCall,
}: {
  state: GatewayState;
  ending?: boolean;
  onEndCall: () => void;
}) {
  const profile = state.profile;
  const running = state.sessionState === "running";
  const degraded = Object.values(state.degraded);

  return (
    <>
      <StatusStrip connection={state.connection} sessionState={state.sessionState} />

      {state.lastError ? (
        <View style={s.problem}>
          <Ionicons name="warning-outline" size={18} color={color.danger} />
          <Text style={s.problemText}>{state.lastError}</Text>
        </View>
      ) : null}

      {profile ? <RiskBand profile={profile} /> : null}

      {running && !profile ? (
        <Card style={s.block}>
          <Text style={s.blockBody}>
            Listening. The first assessment lands once there is enough of the call to read —
            analysis runs on a cadence, not word by word.
          </Text>
        </Card>
      ) : null}

      {degraded.map((speaker) => (
        <View key={speaker.speakerId} style={s.degraded}>
          <Ionicons name="mic-off-outline" size={16} color={color.warning} />
          <Text style={s.degradedText}>
            {speaker.speakerId}: {speaker.reason}
          </Text>
        </View>
      ))}

      {state.turns.length > 0 ? (
        <>
          <SectionLabel>Transcript</SectionLabel>
          <Card>
            <ScrollView style={s.transcript} nestedScrollEnabled>
              {state.turns.map((turn) => (
                <View key={`${turn.seq}-${turn.sourceId ?? ""}`} style={s.turn}>
                  <Text
                    style={[
                      s.speaker,
                      { color: turn.role === "counterparty" ? color.textSecondary : color.accent },
                    ]}
                  >
                    {turn.speakerLabel}
                  </Text>
                  <Text style={s.turnText}>{turn.text}</Text>
                </View>
              ))}
            </ScrollView>
          </Card>
        </>
      ) : null}

      <Button
        label={ending ? "Ending…" : "End call"}
        tone="danger"
        disabled={ending}
        onPress={onEndCall}
        style={s.action}
      />

      {state.lastPass ? (
        <Text style={s.footnote}>
          Pass {state.lastPass.pass} · {state.lastPass.latencyMs} ms
          {state.transport ? ` · ${state.transport} transport` : ""}
          {state.backlogGap ? " · part of the event backlog was lost" : ""}
        </Text>
      ) : null}
    </>
  );
}

export function RiskBand({ profile }: { profile: RiskProfile }) {
  const verdict = verdictFor(profile.risk);
  const tone = verdictColor[verdict];
  return (
    <View style={[s.band, { backgroundColor: verdictTint[verdict] }]}>
      <View style={s.bandHead}>
        <Text style={[s.bandRisk, { color: tone }]}>{profile.risk.toUpperCase()}</Text>
        <Text style={[s.bandScore, { color: tone }]}>{profile.score}</Text>
      </View>
      <Text style={s.bandHeadline}>{profile.headline}</Text>
      {profile.advice ? <Text style={[s.bandAdvice, { color: tone }]}>{profile.advice}</Text> : null}
      {profile.changed ? <Text style={s.bandChanged}>{profile.changed}</Text> : null}

      {profile.signals.map((signal, index) => (
        <View key={`${signal.type}-${index}`} style={s.signal}>
          <Text style={[s.signalType, { color: tone }]}>{signal.type}</Text>
          <Text style={s.signalQuote}>“{signal.quote}”</Text>
          <Text style={s.signalWhy}>{signal.why}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusStrip({ connection, sessionState }: { connection: string; sessionState: string }) {
  const live = connection === "open" && sessionState === "running";
  const tone = live ? color.accent : connection === "reconnecting" ? color.warning : color.textMuted;
  return (
    <View style={s.strip}>
      <View style={[s.stripDot, { backgroundColor: tone }]} />
      <Text style={[s.stripText, { color: tone }]}>
        {connection === "open" ? sessionState : connection}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: space.md },
  stripDot: { width: 8, height: 8, borderRadius: radius.pill },
  stripText: { ...type.caption, letterSpacing: 0.4 },

  block: { padding: space.lg, gap: space.sm, marginBottom: space.md },
  blockBody: { ...type.label, color: color.textSecondary, lineHeight: 19 },
  action: { marginTop: space.md },

  problem: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    backgroundColor: color.dangerTint,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  problemText: { ...type.label, color: color.danger, flex: 1, lineHeight: 18 },

  degraded: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    backgroundColor: color.warningTint,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  degradedText: { ...type.caption, color: color.warning, flex: 1 },

  band: { borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  bandHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  bandRisk: { ...type.eyebrow },
  bandScore: { fontSize: 26, fontWeight: "600" },
  bandHeadline: { ...type.bodyStrong, color: color.text, marginTop: space.sm, lineHeight: 21 },
  bandAdvice: { ...type.label, marginTop: space.sm, lineHeight: 19 },
  bandChanged: { ...type.caption, color: color.textMuted, marginTop: space.sm, lineHeight: 17 },
  signal: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  signalType: { ...type.eyebrow },
  signalQuote: { ...type.label, color: color.text, marginTop: 4, fontStyle: "italic", lineHeight: 19 },
  signalWhy: { ...type.caption, color: color.textMuted, marginTop: 4, lineHeight: 17 },

  transcript: { maxHeight: 300, paddingHorizontal: space.lg, paddingVertical: space.md },
  turn: { marginBottom: space.md },
  speaker: { ...type.caption, fontWeight: "600" },
  turnText: { ...type.label, color: color.text, marginTop: 2, lineHeight: 20 },

  footnote: { ...type.caption, color: color.textMuted, marginTop: space.md },
});
