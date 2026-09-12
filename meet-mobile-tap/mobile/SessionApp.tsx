/**
 * Xentinela — the app shell, on the build that can hold a real call.
 *
 * Navigation is hand-rolled: five tabs and a one-level stack is the whole map,
 * and plain state keeps it legible. This is the same shell the Expo Go build
 * uses, so the two are one product rather than two that share a name.
 *
 * The call flow lives in the Live tab (`src/screens/LiveTab.tsx`) and is the
 * old wizard's logic unchanged — it is the part that has actually joined a
 * LiveKit room on a phone, and rewriting it would have spent that for nothing.
 *
 * `AlertOverlay` is drawn last, outside the SafeAreaView, because the call it
 * warns about happens in the phone's dialer: the warning has to land on top of
 * whatever is on screen, including a pushed route.
 */
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { COPILOTKIT_RUNTIME_URL } from "./src/config";
import { StoreProvider } from "./src/store";
import { AlertProvider } from "./src/alerts";
import { color, space, type } from "./src/theme";
import { Shield } from "./src/screens/Shield";
import { Activity } from "./src/screens/Activity";
import { CallDetail } from "./src/screens/CallDetail";
import { People } from "./src/screens/People";
import { AddGuardian } from "./src/screens/AddGuardian";
import { Settings } from "./src/screens/Settings";
import { Privacy } from "./src/screens/Privacy";
import { Alerts } from "./src/screens/Alerts";
import { AlertOverlay } from "./src/screens/CallAlert";
import { LiveTab } from "./src/screens/LiveTab";

type TabKey = "shield" | "live" | "activity" | "people" | "settings";

type Route =
  | { name: "callDetail"; id: string }
  | { name: "addGuardian" }
  | { name: "privacy" }
  | { name: "alerts" };

const tabs: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "shield", label: "Shield", icon: "shield-outline", active: "shield" },
  { key: "live", label: "Live", icon: "radio-outline", active: "radio" },
  { key: "activity", label: "Activity", icon: "list-outline", active: "list" },
  { key: "people", label: "People", icon: "people-outline", active: "people" },
  { key: "settings", label: "Settings", icon: "settings-outline", active: "settings" },
];

export default function SessionApp() {
  const assistantEnabled = Boolean(COPILOTKIT_RUNTIME_URL);
  const content = (
    <StoreProvider>
      <AlertProvider>
        <Navigator assistantEnabled={assistantEnabled} />
      </AlertProvider>
    </StoreProvider>
  );
  return COPILOTKIT_RUNTIME_URL ? (
    <CopilotKitProvider runtimeUrl={COPILOTKIT_RUNTIME_URL}>{content}</CopilotKitProvider>
  ) : (
    content
  );
}

function Navigator({ assistantEnabled }: { assistantEnabled: boolean }) {
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

  const goToTab = useCallback((next: TabKey) => {
    setStack([]);
    setTab(next);
  }, []);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <SafeAreaView style={s.safe}>
        {/* The tab screens stay mounted under a pushed route so going back
            restores the list exactly as it was left. It also means the Live
            tab keeps its session while you read something else. */}
        <View style={s.body}>
          <Tabbed tab={tab} assistantEnabled={assistantEnabled} onTab={goToTab} onPush={push} />
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
  assistantEnabled,
  onTab,
  onPush,
}: {
  tab: TabKey;
  assistantEnabled: boolean;
  onTab: (tab: TabKey) => void;
  onPush: (route: Route) => void;
}) {
  // Every tab is rendered and only the selected one is shown. The Live tab
  // holds a socket and possibly a LiveKit room, and unmounting it to look at
  // Activity would drop the call.
  return (
    <>
      <Pane visible={tab === "shield"}>
        <Shield
          onOpenCall={(id) => onPush({ name: "callDetail", id })}
          onOpenActivity={() => onTab("activity")}
          onOpenPeople={() => onTab("people")}
        />
      </Pane>
      <Pane visible={tab === "live"}>
        <LiveTab assistantEnabled={assistantEnabled} />
      </Pane>
      <Pane visible={tab === "activity"}>
        <Activity onOpenCall={(id) => onPush({ name: "callDetail", id })} />
      </Pane>
      <Pane visible={tab === "people"}>
        <People onAddGuardian={() => onPush({ name: "addGuardian" })} />
      </Pane>
      <Pane visible={tab === "settings"}>
        <Settings
          onOpenPrivacy={() => onPush({ name: "privacy" })}
          onOpenAlerts={() => onPush({ name: "alerts" })}
        />
      </Pane>
    </>
  );
}

/** Hidden with `display`, not unmounted — see Tabbed. */
function Pane({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <View style={[s.pane, !visible && s.hidden]}>{children}</View>;
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
  pane: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  hidden: { display: "none" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg },

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
