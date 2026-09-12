/**
 * Adding someone to the alert list. The relationship field is not decoration:
 * the alert reads better as "your daughter Lucía" than as a row in a table.
 */
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Screen, SectionLabel, TopBar } from "../ui";
import { color, radius, space, type } from "../theme";
import { useStore } from "../store";

export function AddGuardian({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState<string>();

  function submit() {
    if (name.trim().length === 0) {
      setError("Enter a name first");
      return;
    }
    dispatch({ type: "addGuardian", name, relationship });
    onDone();
  }

  return (
    <Screen>
      <TopBar title="Add guardian" subtitle="They are alerted on Telegram" onBack={onDone} />

      <SectionLabel>Name</SectionLabel>
      <TextInput
        value={name}
        onChangeText={(next) => {
          setName(next);
          if (error) setError(undefined);
        }}
        placeholder="Lucía M."
        placeholderTextColor={color.muted}
        style={[s.input, error && { borderColor: color.danger }]}
        autoCapitalize="words"
        returnKeyType="next"
      />
      {error ? <Text style={s.error}>{error}</Text> : null}

      <SectionLabel>Relationship</SectionLabel>
      <TextInput
        value={relationship}
        onChangeText={setRelationship}
        placeholder="Daughter"
        placeholderTextColor={color.muted}
        style={s.input}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      <View style={s.actions}>
        <Button label="Cancel" onPress={onDone} />
        <Button label="Add" tone="accent" onPress={submit} />
      </View>

      <Text style={s.footnote}>
        They will be messaged at the same time as everyone else on the list.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    color: color.text,
    ...type.body,
  },
  error: { ...type.caption, color: color.danger, marginTop: space.sm },
  actions: { flexDirection: "row", gap: space.md, marginTop: space.xl },
  footnote: { ...type.caption, color: color.textMuted, marginTop: space.md, lineHeight: 17 },
});
