import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Card, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import { fetchAttemptReview } from "@/lib/exam-service";

interface ReviewRow {
  question_id: string;
  question_text: string;
  options: { id: string; text: string; is_correct: boolean }[];
  marks: number;
  explanation: string | null;
  selected_option: string | null;
  is_correct: boolean | null;
  marks_awarded: number | null;
}

/**
 * Post-submission answer review.
 *
 * Everything shown here comes from get_attempt_review(), which returns data
 * ONLY for a submitted attempt the caller owns, and ONLY when the exam permits
 * answer review (exams.show_answers). Questions are staff-only under RLS — the
 * client never reads them directly — so if the school has review disabled, the
 * RPC simply returns nothing and this screen says so. There is no client-side
 * flag that could be flipped to reveal answers.
 */
export default function ExamReviewScreen() {
  const { attemptId, title } = useLocalSearchParams<{ attemptId: string; title?: string }>();
  const { identity } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!attemptId) return;
    try {
      setRows(await fetchAttemptReview(attemptId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the review.");
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!identity) return null;

  const awarded = rows.reduce((sum, r) => sum + (r.marks_awarded ?? 0), 0);
  const total = rows.reduce((sum, r) => sum + (r.marks ?? 0), 0);

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>
          {title || "Review"}
        </Text>
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={ui.content}>
          {error ? <Text style={ui.error}>{error}</Text> : null}

          {rows.length === 0 ? (
            <Card>
              <Text style={styles.cardTitle}>Review not available</Text>
              <Text style={ui.muted}>
                Your school has not made answers available for this exam, or this attempt has not been submitted yet.
              </Text>
            </Card>
          ) : (
            <>
              <Card>
                <Text style={styles.cardTitle}>Your score</Text>
                <Text style={styles.score}>
                  {awarded}/{total}
                </Text>
              </Card>

              {rows.map((r, i) => {
                const correct = r.is_correct === true;
                const answered = Boolean(r.selected_option);
                return (
                  <Card key={r.question_id}>
                    <View style={styles.qHead}>
                      <Text style={styles.qNum}>Question {i + 1}</Text>
                      <View
                        style={[styles.pill, correct ? styles.pillOk : answered ? styles.pillBad : styles.pillSkip]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            correct ? styles.pillTextOk : answered ? styles.pillTextBad : styles.pillTextSkip,
                          ]}
                        >
                          {correct ? "Correct" : answered ? "Incorrect" : "Not answered"}
                          {r.marks_awarded != null ? ` · ${r.marks_awarded}/${r.marks}` : ""}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.qText}>{r.question_text}</Text>

                    {r.options.length > 0 ? (
                      <View style={styles.opts}>
                        {r.options.map((o) => {
                          const chosen = (r.selected_option ?? "").split(",").includes(o.id);
                          return (
                            <View
                              key={o.id}
                              style={[
                                styles.opt,
                                o.is_correct && styles.optCorrect,
                                chosen && !o.is_correct && styles.optWrong,
                              ]}
                            >
                              <Text style={styles.optMark}>
                                {o.is_correct ? "✓" : chosen ? "✗" : "  "}
                              </Text>
                              <Text style={[styles.optText, o.is_correct && styles.optTextCorrect]}>{o.text}</Text>
                              {chosen ? <Text style={styles.yours}>your answer</Text> : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : r.selected_option ? (
                      <View style={styles.textAnswer}>
                        <Text style={styles.textAnswerLabel}>Your answer</Text>
                        <Text style={styles.optText}>{r.selected_option}</Text>
                      </View>
                    ) : null}

                    {r.explanation ? (
                      <View style={styles.explain}>
                        <Text style={styles.explainLabel}>Explanation</Text>
                        <Text style={ui.muted}>{r.explanation}</Text>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  bar: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.white, fontSize: 30, fontWeight: "800", lineHeight: 34 },
  barTitle: { color: colors.white, fontSize: 17, fontWeight: "800", flex: 1 },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  score: { color: colors.navy, fontSize: 32, fontWeight: "900" },
  qHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  qNum: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  qText: { color: colors.ink, fontSize: 15, fontWeight: "600", lineHeight: 22 },
  opts: { gap: 8, marginTop: 4 },
  opt: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, backgroundColor: colors.canvas },
  optCorrect: { borderColor: "#ABEFC6", backgroundColor: colors.successSoft },
  optWrong: { borderColor: "#FECDCA", backgroundColor: colors.dangerSoft },
  optMark: { fontWeight: "900", fontSize: 14, color: colors.ink, width: 14 },
  optText: { color: colors.ink, fontSize: 14, flex: 1, lineHeight: 20 },
  optTextCorrect: { fontWeight: "700" },
  yours: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  textAnswer: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, backgroundColor: colors.canvas, gap: 3 },
  textAnswerLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  explain: { borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: 10, gap: 2, marginTop: 2 },
  explainLabel: { color: colors.navy, fontSize: 12, fontWeight: "800" },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  pillOk: { backgroundColor: colors.successSoft, borderColor: "#ABEFC6" },
  pillBad: { backgroundColor: colors.dangerSoft, borderColor: "#FECDCA" },
  pillSkip: { backgroundColor: colors.canvas, borderColor: colors.line },
  pillText: { fontSize: 11, fontWeight: "800" },
  pillTextOk: { color: colors.success },
  pillTextBad: { color: colors.danger },
  pillTextSkip: { color: colors.muted },
});
