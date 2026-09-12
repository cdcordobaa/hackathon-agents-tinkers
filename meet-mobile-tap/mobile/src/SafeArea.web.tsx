/** Web has no notch to avoid, and no SafeAreaView to do it with. See SafeArea.tsx. */
import { View, type ViewProps } from "react-native";

export function SafeArea(props: ViewProps) {
  return <View {...props} />;
}
