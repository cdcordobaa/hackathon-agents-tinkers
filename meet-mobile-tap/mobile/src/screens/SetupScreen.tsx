/**
 * Two ways to get to a call, kept visibly separate so no one confuses them:
 *
 *   - Create a session: pick a transport, `POST /session` mints a brand new
 *     one, this phone drives it start to finish. Nothing here connects
 *     anything yet — the gateway socket does not open until Continue is
 *     pressed.
 *   - Join a session: paste the id the BROWSER's screen is showing (see
 *     web/src/main.ts) and attach to the session it already created and is
 *     already feeding a transcript into. This phone sends no `session.start`
 *     here — see gateway/client.ts's `join()` for why that would be a bug,
 *     not a formality.
 *
 * The gateway session id and the LiveKit ROOM name are two different
 * identifiers for two different things (see the note under the Join tab and
 * ../livekit/LiveKitCallPanel.tsx) — this screen only ever collects the
 * former; the room join happens on the call screen, from this build's own
 * LiveKit env token.
 *
 * The full mobile-call-ui spec asks for the gateway to advertise which
 * transports are actually available so an unavailable one is never offered.
 * shared/'s event protocol has no such event in this pass (see
 * shared/src/events.ts — session.state reports the transport a session
 * already runs on, not which ones exist to pick from), so Create's list is a
 * static list of the three kinds shared/ defines. Wiring live availability
 * is gateway work, not something the client can fabricate honestly.
 */
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { TranscriptSourceKind } from "../../../shared/src";
import { C, styles } from "../styles";

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
    description:
      "Join a WebRTC room from this phone. This phone's own mic is call-only — it publishes audio but does not transcribe it. For a live transcript and risk analysis on this path, don't create a session here: use \"Join a session\" with the id a browser tab on the same room is showing — the browser transcribes every participant and feeds this session.",
  },
];

type Mode = "create" | "join";

export function SetupScreen({
  selected,
  onSelect,
  onContinue,
  joinSessionId,
  onJoinSessionIdChange,
  onJoin,
}: {
  selected: TranscriptSourceKind;
  onSelect: (kind: TranscriptSourceKind) => void;
  onContinue: () => void;
  joinSessionId: string;
  onJoinSessionIdChange: (id: string) => void;
  onJoin: () => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const trimmedJoinId = joinSessionId.trim();

  return (
    <ScrollView contentContainerStyle={styles.scrollPage}>
      <Text style={styles.eyebrow}>SecureGuIA</Text>
      <Text style={styles.title}>Start a monitored call</Text>
      <Text style={styles.body}>
        Watches a live call and flags social-engineering as it happens — a risk score you can
        check against what was actually said, not a black box.
      </Text>

      <View style={styles.segment}>
        <ModeButton label="Create a session" active={mode === "create"} onPress={() => setMode("create")} />
        <ModeButton label="Join a session" active={mode === "join"} onPress={() => setMode("join")} />
      </View>

      {mode === "create" ? (
        <>
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
        </>
      ) : (
        <>
          <Text style={[styles.eyebrow, { marginTop: 8 }]}>Gateway session id</Text>
          <View style={styles.card}>
            <Text style={styles.body}>
              Paste the session id shown on the browser tab that is already on this call — that
              page created the session and is feeding it a live transcript. This phone attaches to
              that SAME session; it does not start a new one.
            </Text>
            <TextInput
              value={joinSessionId}
              onChangeText={onJoinSessionIdChange}
              placeholder="session id from the browser screen"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.small}>
              This is NOT the LiveKit room name. To have your own mic in the call, this phone joins
              the LiveKit room separately, on the next screen, using its own env-configured token —
              pasting a room name here would attach to the wrong thing.
            </Text>
          </View>

          <Pressable
            style={[styles.primary, { marginTop: 8 }, !trimmedJoinId && styles.primaryDisabled]}
            onPress={onJoin}
            disabled={!trimmedJoinId}
          >
            <Text style={styles.primaryLabel}>Join session</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}
