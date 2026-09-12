/**
 * The one screen every path to a running call must pass through. Buttons
 * stay disabled until `ready` (the gateway WebSocket is open) — sending
 * consent.granted/declined any earlier would be silently dropped by
 * GatewaySessionClient.send, which only transmits on an open socket.
 *
 * Declining ends the session outright (GatewaySessionClient.declineConsent
 * both sends consent.declined and closes the socket) rather than leaving it
 * sitting in awaiting-consent — there is no path from here back to a
 * connected call without going through Continue again from scratch.
 */
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { C, styles } from "../styles";

export function ConsentScreen({
  ready,
  error,
  onGrant,
  onDecline,
}: {
  ready: boolean;
  error: string | undefined;
  onGrant: () => void;
  onDecline: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollPage}>
      <Text style={styles.eyebrow}>Before this call connects</Text>
      <Text style={styles.title}>This call will be recorded and analysed</Text>

      <View style={styles.card}>
        <Text style={styles.body}>
          Everything said on this call will be transcribed in real time and analysed for
          social-engineering and fraud risk. The transcript, the risk assessment, and your
          decision on this screen become part of this session's record.
        </Text>
        <Text style={styles.body}>
          If more than one person is on the call, every state that requires all-party consent
          needs everyone's agreement before this can proceed.
        </Text>
      </View>

      {error ? (
        <View style={[styles.banner, { borderColor: C.danger, backgroundColor: "#1C262A" }]}>
          <Text style={[styles.bannerText, { color: C.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Pressable style={[styles.primary, !ready && styles.primaryDisabled]} onPress={onGrant} disabled={!ready}>
        {ready ? (
          <Text style={styles.primaryLabel}>I agree — start the call</Text>
        ) : (
          <View style={styles.row}>
            <ActivityIndicator color="#06282B" />
            <Text style={styles.primaryLabel}>Connecting to session…</Text>
          </View>
        )}
      </Pressable>
      <Pressable style={styles.secondary} onPress={onDecline}>
        <Text style={styles.secondaryLabel}>Decline — don't start</Text>
      </Pressable>
    </ScrollView>
  );
}
