/**
 * `SafeAreaView` on the platforms that have one.
 *
 * Split by platform extension rather than a `Platform.OS` branch because the
 * problem is resolution, not rendering: react-native-web has no SafeAreaView
 * export at all, so a plain `import { SafeAreaView } from "react-native"`
 * fails at bundle time on web before any branch could run. Metro picks
 * `.web.tsx` for web and this file everywhere else.
 */
import { SafeAreaView, type ViewProps } from "react-native";

export function SafeArea(props: ViewProps) {
  return <SafeAreaView {...props} />;
}
