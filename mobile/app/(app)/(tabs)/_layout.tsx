import { Tabs } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { canCaptureAttendance } from "@/lib/attendance-types";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  const { identity } = useAuth();
  const role = identity?.role ?? "";
  // Capture roles only. Students and parents keep the two-tab shell until the
  // "my attendance" view ships; hiding the tab is presentation only — the batch
  // RPCs remain the authority on who may write attendance.
  const showAttendance = canCaptureAttendance(role);
  // Exams are the student's own papers. start_exam_attempt is the authority on
  // who may sit one; hiding the tab is presentation only.
  const showExams = role === "student";

  return <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.navy }, headerTintColor: colors.white, tabBarActiveTintColor: colors.gold, tabBarInactiveTintColor: colors.muted, tabBarStyle: { borderTopColor: colors.line }, headerTitleStyle: { fontWeight: "800" } }}>
    <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home" }} />
    <Tabs.Screen name="attendance" options={{ title: "Take attendance", tabBarLabel: "Attendance", href: showAttendance ? undefined : null }} />
    <Tabs.Screen name="exams" options={{ title: "My exams", tabBarLabel: "Exams", href: showExams ? undefined : null }} />
    <Tabs.Screen name="profile" options={{ title: "My profile", tabBarLabel: "Profile" }} />
  </Tabs>;
}
