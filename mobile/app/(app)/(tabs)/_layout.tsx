import { Tabs } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { canCaptureAttendance } from "@/lib/attendance-types";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  const { identity } = useAuth();
  const role = identity?.role ?? "";
  // Capture roles only. Students and parents keep the shell until the
  // "my attendance" view ships; hiding the tab is presentation only — the batch
  // RPCs remain the authority on who may write attendance.
  const showAttendance = canCaptureAttendance(role);
  // Exams are the student's own papers. start_exam_attempt is the authority on
  // who may sit one; hiding the tab is presentation only.
  const showExams = role === "student";
  // Read-only attendance for the people it belongs to. my_linked_student_ids()
  // plus RLS decide whose records are readable; this only decides who sees a tab.
  const showMyAttendance = role === "student" || role === "parent";
  // Fees/payments are parent-facing only, mirroring the web my-children page.
  // phase1_income_self_read (student_id IN my_linked_student_ids()) is the real
  // boundary; hiding the tab from other roles is presentation only.
  const showMyFees = role === "parent";
  // Messages is open to every signed-in role. messaging_policy decides who may
  // actually start a conversation, server-side, inside search_messageable_users.
  const showMessages = Boolean(identity);

  return <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.navy }, headerTintColor: colors.white, tabBarActiveTintColor: colors.gold, tabBarInactiveTintColor: colors.muted, tabBarStyle: { borderTopColor: colors.line }, headerTitleStyle: { fontWeight: "800" } }}>
    <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home" }} />
    <Tabs.Screen name="attendance" options={{ title: "Take attendance", tabBarLabel: "Attendance", href: showAttendance ? undefined : null }} />
    <Tabs.Screen name="my-attendance" options={{ title: "Attendance", tabBarLabel: "Attendance", href: showMyAttendance ? undefined : null }} />
    <Tabs.Screen name="my-fees" options={{ title: "Fees", tabBarLabel: "Fees", href: showMyFees ? undefined : null }} />
    <Tabs.Screen name="exams" options={{ title: "My exams", tabBarLabel: "Exams", href: showExams ? undefined : null }} />
    <Tabs.Screen name="messages" options={{ title: "Messages", tabBarLabel: "Messages", href: showMessages ? undefined : null }} />
    <Tabs.Screen name="profile" options={{ title: "My profile", tabBarLabel: "Profile" }} />
  </Tabs>;
}
