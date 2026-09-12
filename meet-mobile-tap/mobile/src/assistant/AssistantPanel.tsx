/**
 * A headless chat panel embedded in the call screen, not a full screen of
 * its own — the risk HUD stays visible above it the whole time the
 * assistant is open (add-copilot-fraud-assistant design.md: "Chat competes
 * for attention with a live call. -> The HUD is primary and always visible").
 *
 * Structure copied from
 * ../../../agents-everywhere-starter-kit/apps/mobile/src/chat.tsx: tool
 * calls render through `useRenderToolCall()`, never a hand-rolled registry —
 * that file's own header explains why walking it by hand silently breaks
 * human-in-the-loop, which is reason enough to keep the pattern even though
 * this build has no HITL tools yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useAgent, useCopilotKit, useRenderToolCall, type ToolCall } from "@copilotkit/react-native/headless";
import { createUserMessageId } from "./message-id";
import { C, styles } from "../styles";

export function AssistantPanel() {
  const listRef = useRef<FlatList>(null);
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!isReady) {
      setError("Still connecting to the assistant runtime. Try again in a moment.");
      return;
    }
    setDraft("");
    setError(undefined);
    setBusy(true);
    try {
      agent.addMessage({ id: createUserMessageId(), role: "user", content: text });
      await copilotkit.runAgent({ agent });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, copilotkit, draft, busy, isReady]);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: (event) => {
        if (event.context?.agentId !== "default" && event.context?.agentId) return;
        setError(event.error instanceof Error ? event.error.message : String(event.error));
        setBusy(false);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  const messages = agent.messages ?? [];
  const conversation = messages.filter((m) => m.role === "user" || m.role === "assistant");

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={conversation}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={styles.small}>
            Ask "Why is the risk elevated?", "What did they just ask me to do?", or "Explain the
            first signal." Answers are grounded in this call's live transcript and assessment.
          </Text>
        }
        renderItem={({ item: message }) => {
          const isUser = message.role === "user";
          const text = typeof message.content === "string" ? message.content : "";
          const toolCalls: ToolCall[] = "toolCalls" in message ? (message.toolCalls ?? []) : [];

          return (
            <View style={{ marginVertical: 4 }}>
              {text ? (
                <View style={[local.bubble, isUser ? local.bubbleUser : local.bubbleAgent]}>
                  <Text style={isUser ? local.bubbleTextUser : local.bubbleTextAgent}>{text}</Text>
                </View>
              ) : null}
              {toolCalls.map((toolCall) => {
                const toolMessage = messages.find(
                  (candidate) =>
                    candidate.role === "tool" && "toolCallId" in candidate && candidate.toolCallId === toolCall.id,
                );
                return <View key={toolCall.id}>{renderToolCall({ toolCall, toolMessage: toolMessage as never })}</View>;
              })}
            </View>
          );
        }}
      />

      {error ? (
        <View style={[styles.banner, { borderColor: C.danger, marginTop: 6 }]}>
          <Text style={[styles.bannerText, { color: C.danger }]}>{error}</Text>
        </View>
      ) : null}

      <View style={local.composer}>
        <TextInput
          style={local.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about this call"
          placeholderTextColor={C.faint}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable style={[styles.primary, local.sendBtn]} onPress={() => void send()} disabled={busy || !isReady}>
          {busy ? <ActivityIndicator color="#06282B" size="small" /> : <Text style={styles.primaryLabel}>Send</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const local = {
  bubble: { marginVertical: 3, padding: 10, borderRadius: 10, maxWidth: "88%" as const },
  bubbleUser: { alignSelf: "flex-end" as const, backgroundColor: C.accent },
  bubbleAgent: { alignSelf: "flex-start" as const, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  bubbleTextUser: { color: "#06282B", fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  bubbleTextAgent: { color: C.text, fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: "row" as const, gap: 8, paddingTop: 8 },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
  sendBtn: { paddingHorizontal: 18, paddingVertical: 10 },
};
