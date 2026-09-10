import { Tabs } from "expo-router";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.navy }, headerTintColor: colors.white, tabBarActiveTintColor: colors.gold, tabBarInactiveTintColor: colors.muted, tabBarStyle: { borderTopColor: colors.line }, headerTitleStyle: { fontWeight: "800" } }}>
    <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home" }} />
    <Tabs.Screen name="profile" options={{ title: "My profile", tabBarLabel: "Profile" }} />
  </Tabs>;
}
