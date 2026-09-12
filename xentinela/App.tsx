/**
 * Xentinela — the app shell.
 *
 * Navigation is hand-rolled on purpose: four tabs and a one-level stack is the
 * whole map, and doing it with plain state keeps the project free of native
 * modules, which is what lets it run in Expo Go with no dev client.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { StoreProvider } from "./src/store";
import { AlertProvider } from "./src/alerts";
import { color, radius, space, type } from "./src/theme";
import { Shield } from "./src/screens/Shield";
import { Activity } from "./src/screens/Activity";
import { CallDetail } from "./src/screens/CallDetail";
import { People } from "./src/screens/People";
import { AddGuardian } from "./src/screens/AddGuardian";
import { Settings } from "./src/screens/Settings";
import { Privacy } from "./src/screens/Privacy";
import { Alerts } from "./src/screens/Alerts";
import { AlertOverlay } from "./src/screens/CallAlert";
import { LiveCall } from "./src/screens/LiveCall";

type TabKey = "shield" | "live" | "activity" | "people" | "settings";

type Route =
  | { name: "callDetail"; id: string }
  | { name: "addGuardian" }
  | { name: "privacy" }
  | { name: "alerts" };

const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; active: keyof typeof Ionicons.glyphMap }[] = [
  { key: "shield", label: "Shield", icon: "shield-outline", active: "shield" },
  { key: "live", label: "Live", icon: "radio-outline", active: "radio" },
  { key: "activity", label: "Activity", icon: "list-outline", active: "list" },
  { key: "people", label: "People", icon: "people-outline", active: "people" },
  { key: "settings", label: "Settings", icon: "settings-outline", active: "settings" },
];

export default function App() {
  return (
    <StoreProvider>
      <AlertProvider>
        <Navigator />
      </AlertProvider>
    </StoreProvider>
  );
}

function Navigator() {
  const [tab, setTab] = useState<TabKey>("shield");
  const [stack, setStack] = useState<Route[]>([]);

  const top = stack[stack.length - 1];
  const push = useCallback((route: Route) => setStack((current) => [...current, route]), []);
  const pop = useCallback(() => setStack((current) => current.slice(0, -1)), []);

  // Android's back gesture has to unwind the stack, or it closes the app from
  // a detail screen and the navigation reads as broken.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length === 0) return false;
      pop();
      return true;
    });
    return () => subscription.remove();
  }, [stack.length, pop]);

  function goToTab(next: TabKey) {
    setStack([]);
    setTab(next);
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <SafeAreaView style={s.safe}>
        {/* The tab screens stay mounted under the pushed route so that going
            back returns to the list exactly as it was left — same filter, same
            scroll position. Swapping them out loses both. */}
        <View style={s.body}>
          <Tabbed tab={tab} onTab={goToTab} onPush={push} />
          {top ? (
            <View style={s.overlay}>
              <Stacked route={top} onBack={pop} />
            </View>
          ) : null}
        </View>
        {top ? null : <TabBar tab={tab} onTab={goToTab} />}
      </SafeAreaView>
      <AlertOverlay onOpenCall={(id) => push({ name: "callDetail", id })} />
    </View>
  );
}

function Tabbed({
  tab,
  onTab,
  onPush,
}: {
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  onPush: (route: Route) => void;
}) {
  switch (tab) {
    case "shield":
      return (
        <Shield
          onOpenCall={(id) => onPush({ name: "callDetail", id })}
          onOpenActivity={() => onTab("activity")}
          onOpenPeople={() => onTab("people")}
        />
      );
    case "live":
      // No back gesture out of a tab, so "back" is the way it came in.
      return <LiveCall onBack={() => onTab("shield")} />;
    case "activity":
      return <Activity onOpenCall={(id) => onPush({ name: "callDetail", id })} />;
    case "people":
      return <People onAddGuardian={() => onPush({ name: "addGuardian" })} />;
    case "settings":
      return (
        <Settings
          onOpenPrivacy={() => onPush({ name: "privacy" })}
          onOpenAlerts={() => onPush({ name: "alerts" })}
        />
      );
  }
}

function Stacked({ route, onBack }: { route: Route; onBack: () => void }) {
  switch (route.name) {
    case "callDetail":
      return <CallDetail id={route.id} onBack={onBack} />;
    case "addGuardian":
      return <AddGuardian onDone={onBack} />;
    case "privacy":
      return <Privacy onBack={onBack} />;
    case "alerts":
      return <Alerts onBack={onBack} />;
  }
}

function TabBar({ tab, onTab }: { tab: TabKey; onTab: (tab: TabKey) => void }) {
  return (
    <View style={s.tabBar}>
      {tabs.map((entry) => {
        const selected = entry.key === tab;
        return (
          <Pressable
            key={entry.key}
            onPress={() => onTab(entry.key)}
            style={s.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={entry.label}
          >
            <Ionicons
              name={selected ? entry.active : entry.icon}
              size={22}
              color={selected ? color.accent : color.textMuted}
            />
            <Text style={[s.tabLabel, { color: selected ? color.accent : color.textMuted }]}>
              {entry.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  safe: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: color.bg,
  },

  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
    paddingTop: space.sm,
    paddingBottom: Platform.OS === "ios" ? space.xs : space.sm,
  },
  tab: { flex: 1, alignItems: "center", gap: 3, paddingVertical: space.xs },
  tabLabel: { ...type.caption, fontSize: 11 },
});
