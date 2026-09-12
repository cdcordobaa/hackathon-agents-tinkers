/**
 * A call being analysed right now, straight off the detection gateway.
 *
 * Everything on this screen is server-sent: the transcript is what the
 * transport heard, and the risk band is the analyzer's latest pass, not a
 * local guess. The one thing the phone decides is consent — nothing is
 * transcribed or analysed until the button below is pressed.
 *
 * When the call ends it is written into the same store the rest of the app
 * reads, so it appears in Activity next to every other call.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Screen, SectionLabel, TopBar } from "../ui";
import { color, radius, space, type, verdictColor, verdictTint } from "../theme";
import { formatDuration, useStore } from "../store";
import { useAlert, type AlertLevel } from "../alerts";
import { useLiveCall } from "../live/useLiveCall";
import { GATEWAY_URL } from "../live/config";
import { verdictFor, type RiskLevel, type RiskProfile } from "../live/wire";

/** The analyzer's four levels, and the three degrees of interruption. `none`
 *  has no alert on purpose: a warning that says "nothing is wrong" teaches
 *  people to ignore the ones that matter. */
function alertLevelFor(risk: RiskLevel): AlertLevel | null {
  if (risk === "high") return "high";
  if (risk === "elevated") return "elevated";
  if (risk === "low") return "low";
  return null;
}

export function LiveCall({ onBack }: { onBack: () => void }) {
  const { guardians, dispatch } = useStore();
  const { state, start, grantConsent, declineConsent, end } = useLiveCall();
  const { raiseLive, clear, setLiveHangUp } = useAlert();
  const [saved, setSaved] = useState(false);
  const recorded = useRef(false);

  const profile = state.profile;
  const verdict = verdictFor((profile ?? state.peak)?.risk ?? "none");

  // Hanging up from the overlay has to reach this session — the overlay only
  // asks, and only this screen holds the socket that can answer.
  useEffect(() => {
    setLiveHangUp(end);
    return () => setLiveHangUp(undefined);
  }, [setLiveHangUp, end]);

  // Every analyzer pass lands on the overlay. This is the whole point of the
  // screen: the warning a person actually sees is drawn from what the model
  // found in this call, not from a script.
  useEffect(() => {
    if (!profile || state.sessionState !== "running") return;
    const level = alertLevelFor(profile.risk);
    if (!level) return;
    raiseLive(level, {
      caller: state.transport === "replay" ? "Unknown" : "Live call",
      number: state.sessionId ? `session ${state.sessionId.slice(0, 8)}` : "—",
      headline: profile.headline,
      // `low` carries no instruction — it is context, not orders.
      advice: level === "low" ? "" : profile.advice,
      signals: profile.signals.map((signal) => ({ label: signal.type, quote: signal.quote })),
    });
  }, [profile, state.sessionState, state.transport, state.sessionId, raiseLive]);

  // The call is over; the warning drawn over it has nothing left to warn about.
  useEffect(() => {
    if (state.sessionState === "ended") clear();
  }, [state.sessionState, clear]);

  // One write, on the transition into `ended`. The ref rather than `saved`
  // alone because this effect can re-run before the state update lands.
  useEffect(() => {
    if (state.sessionState !== "ended" || recorded.current) return;
    if (state.turns.length === 0 && !state.peak) return; // Declined before anything ran.
    recorded.current = true;
    const final = state.profile ?? state.peak;
    const settled = verdictFor(final?.risk ?? "none");
    dispatch({
      type: "logCall",
      call: {
        id: `c${Date.now()}`,
        caller: state.transport === "replay" ? "Unknown number" : "Live call",
        number: state.sessionId ? `session ${state.sessionId.slice(0, 8)}` : "—",
        day: "Today",
        time: new Date().toTimeString().slice(0, 5),
        durationSec: Math.round(state.atMs / 1000),
        verdict: settled,
        headline: final?.headline ?? "No assessment",
        signals: (final?.signals ?? []).map((signal) => `${signal.type}: “${signal.quote}”`),
        // Same rule the in-call alert uses: everyone at once, and only when
        // there was something to tell them about.
        alerted: settled === "safe" ? [] : guardians.map((guardian) => guardian.id),
        reported: false,
      },
    });
    setSaved(true);
  }, [state, guardians, dispatch]);

  const idle = state.connection === "idle";
  const connecting = state.connection === "connecting";
  const awaitingConsent = state.sessionState === "awaiting-consent";
  const running = state.sessionState === "running";
  const ended = state.sessionState === "ended";

  return (
    <Screen>
      <TopBar
        title="Live call"
        subtitle={
          running
            ? `Analysing · ${formatDuration(Math.round(state.atMs / 1000))}`
            : ended
              ? "Call ended"
              : GATEWAY_URL.replace(/^https?:\/\//, "")
        }
        onBack={onBack}
      />

      <StatusStrip state={state.connection} sessionState={state.sessionState} />

      {state.error ? (
        <View style={s.problem}>
          <Ionicons name="warning-outline" size={18} color={color.danger} />
          <Text style={s.problemText}>{state.error}</Text>
        </View>
      ) : null}

      {idle ? (
        <Card style={s.block}>
          <Text style={s.blockTitle}>Nothing is being analysed</Text>
          <Text style={s.blockBody}>
            Open a session on the gateway at {GATEWAY_URL}. The replay transport plays a
            scripted call through the same pipeline a real one uses — same transcript
            events, same analyzer, same verdicts.
          </Text>
          <Button label="Open a session" tone="accent" onPress={() => start("replay")} style={s.action} />
        </Card>
      ) : null}

      {connecting ? (
        <Card style={s.block}>
          <ActivityIndicator color={color.accent} />
          <Text style={[s.blockBody, { textAlign: "center", marginTop: space.md }]}>
            Reaching the gateway…
          </Text>
        </Card>
      ) : null}

      {awaitingConsent ? (
        <Card style={s.block}>
          <Text style={s.blockTitle}>This call will be listened to</Text>
          <Text style={s.blockBody}>
            The words spoken on this call are transcribed and read by the analyzer while the
            call is happening. Nothing is transcribed and no analysis runs until you agree.
          </Text>
          <View style={s.buttonRow}>
            <Button label="Not now" onPress={declineConsent} style={{ flex: 1 }} />
            <Button label="Agree and start" tone="accent" onPress={grantConsent} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {profile ? <RiskBand profile={profile} verdict={verdict} /> : null}

      {running && !profile ? (
        <Card style={s.block}>
          <Text style={s.blockBody}>
            Listening. The first assessment lands once there is enough of the call to read —
            analysis runs on a cadence, not word by word.
          </Text>
        </Card>
      ) : null}

      {Object.entries(state.degraded).map(([speakerId, reason]) => (
        <View key={speakerId} style={s.degraded}>
          <Ionicons name="mic-off-outline" size={16} color={color.warning} />
          <Text style={s.degradedText}>
            {speakerId}: {reason}
          </Text>
        </View>
      ))}

      {state.turns.length > 0 ? (
        <>
          <SectionLabel>Transcript</SectionLabel>
          <Card>
            <ScrollView style={s.transcript} nestedScrollEnabled>
              {state.turns.map((turn) => (
                <View key={turn.seq} style={s.turn}>
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

      {running ? (
        <Button label="End call" tone="danger" onPress={end} style={s.action} />
      ) : null}

      {ended ? (
        <Card style={s.block}>
          <Text style={s.blockTitle}>Call ended</Text>
          <Text style={s.blockBody}>
            {state.peak
              ? `Highest risk reached: ${state.peak.risk} (${state.peak.score}/100).`
              : "No assessment was produced for this call."}
            {saved ? " Saved to Activity." : ""}
          </Text>
          <Button label="Analyse another call" onPress={() => start("replay")} style={s.action} />
        </Card>
      ) : null}

      {state.pass ? (
        <Text style={s.footnote}>
          Pass {state.pass.pass} · {state.pass.latencyMs} ms
          {state.transport ? ` · ${state.transport} transport` : ""}
          {state.backlogGap ? " · part of the event backlog was lost" : ""}
        </Text>
      ) : null}
    </Screen>
  );
}

function RiskBand({
  profile,
  verdict,
}: {
  profile: RiskProfile;
  verdict: "safe" | "flagged" | "blocked";
}) {
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

function StatusStrip({
  state,
  sessionState,
}: {
  state: string;
  sessionState: string;
}) {
  const live = state === "open" && sessionState === "running";
  const tone = live ? color.accent : state === "reconnecting" ? color.warning : color.textMuted;
  return (
    <View style={s.strip}>
      <View style={[s.stripDot, { backgroundColor: tone }]} />
      <Text style={[s.stripText, { color: tone }]}>
        {state === "open" ? sessionState : state}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: space.md },
  stripDot: { width: 8, height: 8, borderRadius: radius.pill },
  stripText: { ...type.caption, letterSpacing: 0.4 },

  block: { padding: space.lg, gap: space.sm, marginBottom: space.md },
  blockTitle: { ...type.heading, color: color.text },
  blockBody: { ...type.label, color: color.textSecondary, lineHeight: 19 },
  action: { marginTop: space.md },
  buttonRow: { flexDirection: "row", gap: space.sm, marginTop: space.md },

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

  transcript: { maxHeight: 260, paddingHorizontal: space.lg, paddingVertical: space.md },
  turn: { marginBottom: space.md },
  speaker: { ...type.caption, fontWeight: "600" },
  turnText: { ...type.label, color: color.text, marginTop: 2, lineHeight: 20 },

  footnote: { ...type.caption, color: color.textMuted, marginTop: space.md },
});
