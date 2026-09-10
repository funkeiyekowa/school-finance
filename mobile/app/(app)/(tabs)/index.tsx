import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/auth-types";
import { colors } from "@/lib/theme";

type Tile = { label: string; detail: string; icon: string };
const roleTiles: Record<string, Tile[]> = {
  student: [{ icon: "▣", label: "My learning", detail: "Courses and classwork will appear here." }, { icon: "✓", label: "Attendance", detail: "Your attendance overview is coming next." }, { icon: "★", label: "Exams", detail: "Secure CBT exams will appear here." }],
  parent: [{ icon: "◉", label: "My children", detail: "Linked student information will appear here." }, { icon: "✓", label: "Attendance", detail: "View attendance for your child." }, { icon: "₦", label: "Fees", detail: "Balances and payments will appear here." }],
  teacher: [{ icon: "▣", label: "My classes", detail: "Your assigned classes will appear here." }, { icon: "✓", label: "Take attendance", detail: "Class attendance is coming next." }, { icon: "★", label: "Assessments", detail: "Exam and assessment tools are coming next." }],
  staff: [{ icon: "▣", label: "School workspace", detail: "Your authorised work will appear here." }, { icon: "✓", label: "Attendance", detail: "Attendance tools are coming next." }, { icon: "✉", label: "Messages", detail: "School messages are coming next." }],
  admin: [{ icon: "▣", label: "School overview", detail: "Operational insights will appear here." }, { icon: "✓", label: "Attendance", detail: "Monitor attendance across the school." }, { icon: "₦", label: "Finance", detail: "Authorised finance tools will appear here." }]
};

export default function DashboardScreen() {
  const { identity } = useAuth();
  if (!identity) return null;
  const tiles = roleTiles[identity.role] ?? roleTiles.staff;
  const firstName = identity.fullName.split(" ")[0];
  return <ScrollView style={ui.screen} contentContainerStyle={ui.content}><View style={styles.hero}><Text style={styles.school}>{identity.school.name}</Text><Text style={styles.greeting}>Hello, {firstName}</Text><View style={styles.badge}><Text style={styles.badgeText}>{roleLabel(identity.role)}</Text></View></View><SectionTitle title="Your school day" /><Card><Text style={styles.cardTitle}>You are signed in securely</Text><Text style={ui.muted}>This mobile portal is connected to {identity.school.name}. Only the features your school role is authorised to use will be shown.</Text></Card><SectionTitle title="Quick access" /><View style={styles.grid}>{tiles.map((tile) => <Card key={tile.label}><Text style={styles.tileIcon}>{tile.icon}</Text><Text style={styles.cardTitle}>{tile.label}</Text><Text style={ui.muted}>{tile.detail}</Text></Card>)}</View><Text style={styles.note}>Phase 1 dashboard shell. Attendance, exams and messages will be connected only after you approve the next mobile phase.</Text></ScrollView>;
}
const styles = StyleSheet.create({ hero: { backgroundColor: colors.navy, borderRadius: 20, padding: 20, gap: 7 }, school: { color: colors.gold, fontWeight: "800", fontSize: 14 }, greeting: { color: colors.white, fontSize: 27, fontWeight: "900" }, badge: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: "#FFFFFF1F" }, badgeText: { color: "#DDE8F5", fontWeight: "700", fontSize: 12 }, grid: { gap: 12 }, tileIcon: { color: colors.gold, fontSize: 22, fontWeight: "800" }, cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" }, note: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", paddingVertical: 8 } });
