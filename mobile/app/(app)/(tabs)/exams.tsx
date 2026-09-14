import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import { fetchStudentExams, resolveStudent } from "@/lib/exam-service";
import { readProctorSettings, type AttemptRow, type ExamRow } from "@/lib/exam-types";

function fmt(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type Bucket = "available" | "upcoming" | "closed" | "done";

function bucketFor(exam: ExamRow, attempts: AttemptRow[]): Bucket {
  const mine = attempts.filter((a) => a.exam_id === exam.id);
  const submitted = mine.filter((a) => a.status === "submitted" || a.status === "timed_out" || a.status === "graded");
  const inProgress = mine.find((a) => a.status === "in_progress");
  if (inProgress) return "available";

  const max = exam.max_attempts ?? 1;
  if (submitted.length >= max) return "done";

  const now = Date.now();
  if (exam.starts_at && new Date(exam.starts_at).getTime() > now) return "upcoming";
  if (exam.ends_at && new Date(exam.ends_at).getTime() < now) return "closed";
  return "available";
}

export default function ExamsScreen() {
  const { identity } = useAuth();
  const router = useRouter();

  const [exams, setExams] = useState<ExamRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noStudent, setNoStudent] = useState(false);

  const load = useCallback(async () => {
    if (!identity) return;
    setError(null);
    try {
      const student = await resolveStudent(identity.userId, identity.email);
      if (!student) {
        setNoStudent(true);
        return;
      }
      setNoStudent(false);
      const payload = await fetchStudentExams(student);
      setExams(payload.exams);
      setAttempts(payload.attempts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your exams.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!identity) return null;

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const groups: { bucket: Bucket; title: string }[] = [
    { bucket: "available", title: "Available now" },
    { bucket: "upcoming", title: "Upcoming" },
    { bucket: "done", title: "Completed" },
    { bucket: "closed", title: "Closed" },
  ];

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.navy}
        />
      }
    >
      {error ? <Text style={ui.error}>{error}</Text> : null}

      {noStudent ? (
        <Card>
          <Text style={styles.cardTitle}>No student record linked</Text>
          <Text style={ui.muted}>
            This account is not linked to a student record, so no exams can be shown. Ask your school administrator to
            check your profile.
          </Text>
        </Card>
      ) : exams.length === 0 ? (
        <Card>
          <Text style={styles.cardTitle}>No exams yet</Text>
          <Text style={ui.muted}>When your school publishes an exam for you, it will appear here.</Text>
        </Card>
      ) : (
        groups.map((g) => {
          const rows = exams.filter((e) => bucketFor(e, attempts) === g.bucket);
          if (rows.length === 0) return null;
          return (
            <View key={g.bucket} style={styles.group}>
              <SectionTitle title={g.title} />
              {rows.map((exam) => {
                const mine = attempts.filter((a) => a.exam_id === exam.id);
                const latest = mine[0] ?? null;
                const proctor = readProctorSettings(exam.settings);
                const openable = g.bucket === "available";
                const inProgress = mine.some((a) => a.status === "in_progress");

                const card = (
                  <Card>
                    <Text style={styles.cardTitle}>{exam.title}</Text>
                    <Text style={ui.muted}>
                      {[
                        exam.duration_minutes ? `${exam.duration_minutes} min` : null,
                        exam.total_marks ? `${exam.total_marks} marks` : null,
                        exam.starts_at ? `From ${fmt(exam.starts_at)}` : null,
                        exam.ends_at ? `Until ${fmt(exam.ends_at)}` : null,
                      ]
                        .filter(Boolean)
                        .join("  •  ")}
                    </Text>

                    {/* Only warn where it is actionable. On a finished or closed
                        exam the notice is noise — the student cannot act on it. */}
                    {proctor.proctored && (g.bucket === "available" || g.bucket === "upcoming") ? (
                      <View style={styles.warnBox}>
                        <Text style={styles.warnText}>
                          Proctored exam — must be taken on a computer. It cannot be started from the mobile app.
                        </Text>
                      </View>
                    ) : null}

                    {g.bucket === "done" && latest ? (
                      <>
                        <Text style={styles.result}>
                          {latest.percentage != null
                            ? `Score: ${latest.total_score ?? 0}/${latest.total_marks ?? exam.total_marks ?? 0}  (${Math.round(latest.percentage)}%)`
                            : "Submitted — awaiting results."}
                          {latest.passed === true ? "  ✓ Passed" : latest.passed === false ? "  ✗ Not passed" : ""}
                        </Text>
                        {/* get_attempt_review() returns nothing unless the school
                            enabled answer review, so the screen degrades safely. */}
                        {exam.show_answers ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Review answers for ${exam.title}`}
                            onPress={() =>
                              router.push({
                                pathname: "/(app)/exam-review/[attemptId]",
                                params: { attemptId: latest.id, title: exam.title },
                              } as never)
                            }
                          >
                            <Text style={styles.cta}>Review answers →</Text>
                          </Pressable>
                        ) : null}
                      </>
                    ) : null}

                    {openable && !proctor.proctored ? (
                      <Text style={styles.cta}>{inProgress ? "Resume exam →" : "Start exam →"}</Text>
                    ) : null}
                  </Card>
                );

                if (!openable || proctor.proctored) return <View key={exam.id}>{card}</View>;
                return (
                  <Pressable
                    key={exam.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${inProgress ? "Resume" : "Start"} ${exam.title}`}
                    onPress={() => router.push(`/(app)/exam/${exam.id}` as never)}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    {card}
                  </Pressable>
                );
              })}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  group: { gap: 12 },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  cta: { color: colors.navyMid, fontWeight: "800", fontSize: 13, marginTop: 4 },
  result: { color: colors.ink, fontWeight: "700", fontSize: 14, marginTop: 2 },
  warnBox: { backgroundColor: colors.dangerSoft, borderColor: "#FECDCA", borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 4 },
  warnText: { color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  pressed: { opacity: 0.75 },
});
