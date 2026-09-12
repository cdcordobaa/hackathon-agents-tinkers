/**
 * "A healthy-looking UI while the feed is dead is the specific failure this
 * project cares most about" — so these render whenever any of these
 * conditions hold, full stop, never folded into a state that could look
 * ambiguous with "fine".
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ConnectionStatus, DegradedSpeaker } from "../gateway/reducer";
import { C, styles } from "../styles";

export function DegradedBanners({
  connection,
  backlogGap,
  degraded,
}: {
  connection: ConnectionStatus;
  backlogGap: boolean;
  degraded: Record<string, DegradedSpeaker>;
}) {
  const degradedList = Object.values(degraded);
  const connectionDown = connection === "reconnecting" || connection === "closed";

  if (!connectionDown && !backlogGap && degradedList.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      {connectionDown ? (
        <Banner tone="danger">
          {connection === "closed"
            ? "Connection to the session is closed."
            : "Connection to the session was lost — reconnecting…"}
        </Banner>
      ) : null}

      {backlogGap ? (
        <Banner tone="warning">
          Reconnected, but some events between your last update and now could not be replayed. The
          risk and transcript shown may have a gap.
        </Banner>
      ) : null}

      {degradedList.map((d) => (
        <Banner key={d.speakerId} tone="warning">
          Transcription degraded for {d.speakerId}: {d.reason}
        </Banner>
      ))}
    </View>
  );
}

function Banner({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  const color = tone === "danger" ? C.high : C.elevated;
  return (
    <View style={[styles.banner, local.banner, { borderColor: color }]}>
      <View style={[local.dot, { backgroundColor: color }]} />
      <Text style={[styles.bannerText, { color }]}>{children}</Text>
    </View>
  );
}

const local = StyleSheet.create({
  banner: { backgroundColor: "#1C262A" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
