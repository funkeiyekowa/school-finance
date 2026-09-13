import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Card, PrimaryButton, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import {
  fetchActiveExamLock,
  fetchAttemptQuestions,
  fetchExam,
  fetchProctoringState,
  fetchSavedAnswers,
  logProctoringEvent,
  recordViolation,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "@/lib/exam-service";
import {
  isMultiSelect,
  isTextAnswer,
  readProctorSettings,
  unsupportedTypes,
  type AnswerValue,
  type ExamRow,
  type QuestionRow,
  type SubmitResult,
} from "@/lib/exam-types";

type Phase = "loading" | "blocked" | "active" | "finished";

function mmss(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function TakeExamScreen() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const { identity } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [blockedMessage, setBlockedMessage] = useState<string>("");
  const [exam, setExam] = useState<ExamRow | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [index, setIndex] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [violations, setViolations] = useState(0);
  const [maxViolations, setMaxViolations] = useState(3);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [finishedNote, setFinishedNote] = useState<string>("");

  const attemptRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("loading");
  const submittedRef = useRef(false);
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    attemptRef.current = attemptId;
  }, [attemptId]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const finish = useCallback((note: string, res: SubmitResult | null) => {
    submittedRef.current = true;
    setResult(res);
    setFinishedNote(note);
    setPhase("finished");
  }, []);

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    if (!examId || !identity) return;
    let cancelled = false;

    void (async () => {
      try {
        // If the student is locked into a DIFFERENT exam, send them there.
        const locked = await fetchActiveExamLock();
        if (cancelled) return;
        if (locked && locked !== examId) {
          router.replace(`/(app)/exam/${locked}` as never);
          return;
        }

        const examRow = await fetchExam(examId);
        if (cancelled) return;
        if (!examRow) {
          setBlockedMessage("This exam could not be found.");
          setPhase("blocked");
          return;
        }
        setExam(examRow);

        // Proctored exams are refused on mobile. The phone cannot reproduce
        // the browser lockdown (enforced fullscreen, screen capture), so
        // allowing it here would weaken proctoring rather than extend it.
        const proctor = readProctorSettings(examRow.settings);
        setMaxViolations(proctor.maxViolations);
        if (proctor.proctored) {
          setBlockedMessage(
            "This is a proctored exam and must be taken on a computer. Sign in to the school portal on a desktop browser to begin.",
          );
          setPhase("blocked");
          return;
        }

        const started = await startAttempt(examId);
        if (cancelled) return;

        if (started.completed) {
          finish(
            started.completion_message || "This exam has been completed. Your submission has been recorded.",
            started.show_results === true
              ? {
                  total_score: started.total_score ?? undefined,
                  total_marks: started.total_marks ?? undefined,
                  percentage: started.percentage ?? undefined,
                  passed: started.passed ?? null,
                }
              : null,
          );
          return;
        }

        if (!started.ok || !started.attempt_id) {
          setBlockedMessage(
            started.reason
              ? `This exam is not available: ${started.reason.replace(/_/g, " ")}.`
              : "This exam is not available to you right now.",
          );
          setPhase("blocked");
          return;
        }

        const qs = await fetchAttemptQuestions(started.attempt_id);
        if (cancelled) return;

        if (qs.length === 0) {
          setBlockedMessage("This exam has no questions yet.");
          setPhase("blocked");
          return;
        }

        // Refuse rather than partially render. A question type the phone
        // cannot show would be submitted blank and score zero.
        const bad = unsupportedTypes(qs);
        if (bad.length > 0) {
          setBlockedMessage(
            "This exam contains question types the mobile app cannot display yet, so it must be taken on a computer. Your attempt has not been affected.",
          );
          setPhase("blocked");
          return;
        }

        setQuestions(qs);
        setAttemptId(started.attempt_id);

        // Server-recorded strike count (students cannot read proctoring_events).
        const persisted = await fetchProctoringState(started.attempt_id);
        if (!cancelled) setViolations(persisted ?? started.violation_count ?? 0);

        // Restore any answers already saved for this attempt.
        const saved = await fetchSavedAnswers(started.attempt_id);
        if (cancelled) return;
        const restored: Record<string, AnswerValue> = {};
        for (const row of saved) {
          const q = qs.find((x) => x.id === row.question_id);
          if (!q) continue;
          if (isTextAnswer(q.question_type)) restored[q.id] = { text: row.answer_text ?? "" };
          else restored[q.id] = { selected: (row.selected_option ?? "").split(",").filter(Boolean) };
        }
        setAnswers(restored);

        const end = started.ends_at
          ? new Date(started.ends_at).getTime()
          : examRow.duration_minutes
            ? Date.now() + examRow.duration_minutes * 60_000
            : null;
        setEndsAt(end);
        setPhase("active");
      } catch (e) {
        if (cancelled) return;
        setBlockedMessage(e instanceof Error ? e.message : "Unable to start the exam.");
        setPhase("blocked");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [examId, identity, router, finish]);

  // ---- timer --------------------------------------------------------------
  const doSubmit = useCallback(
    async (timedOut: boolean, reason?: string) => {
      const id = attemptRef.current;
      if (!id || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const res = await submitAttempt(id, timedOut, reason);
        finish(timedOut ? "Time is up. Your exam was submitted automatically." : "Your exam has been submitted.", res);
      } catch (e) {
        submittedRef.current = false;
        setSaveWarning(e instanceof Error ? e.message : "Could not submit your exam. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [finish],
  );

  useEffect(() => {
    if (phase !== "active" || endsAt == null) return;
    const tick = () => {
      const secs = Math.round((endsAt - Date.now()) / 1000);
      setRemaining(secs);
      if (secs <= 0) void doSubmit(true, "timed_out");
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [phase, endsAt, doSubmit]);

  // ---- backgrounding = violation -----------------------------------------
  useEffect(() => {
    if (phase !== "active") return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "background" && next !== "inactive") return;
      const id = attemptRef.current;
      if (!id || phaseRef.current !== "active" || submittedRef.current) return;

      void (async () => {
        void logProctoringEvent(id, "app_backgrounded", { platform: "mobile" });
        const res = await recordViolation(id, "app_backgrounded", maxViolations);
        if (!res) return;
        if (typeof res.strike === "number") setViolations(res.strike);
        if (res.action === "terminate") {
          await doSubmit(false, "violation_limit");
        }
      })();
    });
    return () => sub.remove();
  }, [phase, maxViolations, doSubmit]);

  // ---- answering ----------------------------------------------------------
  const current = questions[index] ?? null;

  const persist = useCallback(
    async (q: QuestionRow, value: AnswerValue) => {
      const id = attemptRef.current;
      if (!id) return;
      const ok = await saveAnswer({
        attemptId: id,
        questionId: q.id,
        selectedOption: isTextAnswer(q.question_type) ? null : (value.selected ?? []).join(","),
        answerText: isTextAnswer(q.question_type) ? (value.text ?? "") : null,
        flagged: false,
      });
      setSaveWarning(
        ok ? null : "We couldn't save your last answer. Check your connection — it will be re-saved when you change it again.",
      );
    },
    [],
  );

  function choose(q: QuestionRow, optionId: string) {
    setAnswers((prev) => {
      const existing = prev[q.id]?.selected ?? [];
      const next = isMultiSelect(q.question_type)
        ? existing.includes(optionId)
          ? existing.filter((v) => v !== optionId)
          : [...existing, optionId]
        : [optionId];
      const value: AnswerValue = { selected: next };
      void persist(q, value);
      return { ...prev, [q.id]: value };
    });
  }

  function typeAnswer(q: QuestionRow, text: string) {
    setAnswers((prev) => ({ ...prev, [q.id]: { text } }));
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = setTimeout(() => void persist(q, { text }), 800);
  }

  const answeredCount = useMemo(
    () =>
      questions.filter((q) => {
        const a = answers[q.id];
        if (!a) return false;
        return isTextAnswer(q.question_type) ? Boolean(a.text?.trim()) : (a.selected ?? []).length > 0;
      }).length,
    [questions, answers],
  );

  function confirmSubmit() {
    const unanswered = questions.length - answeredCount;
    Alert.alert(
      "Submit exam?",
      unanswered > 0
        ? `${unanswered} question${unanswered === 1 ? "" : "s"} still unanswered. You cannot change your answers after submitting.`
        : "You cannot change your answers after submitting.",
      [
        { text: "Keep working", style: "cancel" },
        { text: "Submit", style: "destructive", onPress: () => void doSubmit(false, "manual") },
      ],
    );
  }

  // ---- render -------------------------------------------------------------
  const screenOptions = { gestureEnabled: phase !== "active", headerShown: false } as const;

  if (phase === "loading") {
    return (
      <View style={styles.centre}>
        <Stack.Screen options={screenOptions} />
        <ActivityIndicator size="large" color={colors.gold} />
        <Text style={styles.centreText}>Preparing your exam…</Text>
      </View>
    );
  }

  if (phase === "blocked") {
    return (
      <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
        <Stack.Screen options={screenOptions} />
        <Card>
          <Text style={styles.title}>{exam?.title ?? "Exam"}</Text>
          <Text style={ui.muted}>{blockedMessage}</Text>
        </Card>
        <PrimaryButton label="Back to my exams" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  if (phase === "finished") {
    const pct = result?.percentage;
    return (
      <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
        <Stack.Screen options={screenOptions} />
        <Card>
          <Text style={styles.title}>{exam?.title ?? "Exam"}</Text>
          <Text style={ui.muted}>{finishedNote}</Text>
          {result && pct != null ? (
            <>
              <Text style={styles.score}>
                {result.total_score ?? 0}/{result.total_marks ?? 0}
              </Text>
              <Text style={styles.scorePct}>
                {Math.round(pct)}%{result.passed === true ? " — Passed" : result.passed === false ? " — Not passed" : ""}
              </Text>
            </>
          ) : null}
        </Card>
        <PrimaryButton label="Back to my exams" onPress={() => router.replace("/(app)/(tabs)/exams" as never)} />
      </ScrollView>
    );
  }

  if (!current) return null;

  const value = answers[current.id] ?? {};
  const selected = value.selected ?? [];

  return (
    <View style={ui.screen}>
      <Stack.Screen options={screenOptions} />

      <View style={styles.bar}>
        <View style={styles.barLeft}>
          <Text style={styles.barTitle} numberOfLines={1}>
            {exam?.title ?? "Exam"}
          </Text>
          <Text style={styles.barMeta}>
            Question {index + 1} of {questions.length} · {answeredCount} answered
          </Text>
        </View>
        {remaining != null ? (
          <View style={[styles.timer, remaining <= 60 && styles.timerLow]}>
            <Text style={[styles.timerText, remaining <= 60 && styles.timerTextLow]}>{mmss(remaining)}</Text>
          </View>
        ) : null}
      </View>

      {violations > 0 ? (
        <Text style={styles.strike}>
          Warning {violations} of {maxViolations} — leaving the app during an exam is recorded. The exam ends
          automatically at {maxViolations}.
        </Text>
      ) : null}

      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        {saveWarning ? <Text style={ui.error}>{saveWarning}</Text> : null}

        <Card>
          <Text style={styles.qMarks}>
            {current.marks} mark{current.marks === 1 ? "" : "s"}
            {isMultiSelect(current.question_type) ? "  ·  select all that apply" : ""}
          </Text>
          <Text style={styles.qText}>{current.question_text}</Text>
        </Card>

        {isTextAnswer(current.question_type) ? (
          <TextInput
            style={[ui.input, styles.textArea]}
            multiline
            textAlignVertical="top"
            placeholder="Type your answer…"
            placeholderTextColor={colors.muted}
            value={value.text ?? ""}
            onChangeText={(t) => typeAnswer(current, t)}
          />
        ) : (
          current.options.map((opt) => {
            const on = selected.includes(opt.id);
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => choose(current, opt.id)}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
              >
                <View style={[styles.tick, on && styles.tickOn]}>
                  <Text style={[styles.tickText, on && styles.tickTextOn]}>{on ? "✓" : ""}</Text>
                </View>
                <Text style={[styles.optionText, on && styles.optionTextOn]}>{opt.text}</Text>
              </Pressable>
            );
          })
        )}

        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            disabled={index === 0}
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            style={({ pressed }) => [styles.navBtn, index === 0 && styles.navOff, pressed && styles.pressed]}
          >
            <Text style={styles.navText}>Previous</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={index >= questions.length - 1}
            onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            style={({ pressed }) => [
              styles.navBtn,
              index >= questions.length - 1 && styles.navOff,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.navText}>Next</Text>
          </Pressable>
        </View>

        <View style={styles.dots}>
          {questions.map((q, i) => {
            const a = answers[q.id];
            const done = isTextAnswer(q.question_type) ? Boolean(a?.text?.trim()) : (a?.selected ?? []).length > 0;
            return (
              <Pressable
                key={q.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to question ${i + 1}`}
                onPress={() => setIndex(i)}
                style={[styles.dot, done && styles.dotDone, i === index && styles.dotCurrent]}
              >
                <Text style={[styles.dotText, done && styles.dotTextDone]}>{i + 1}</Text>
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton label={submitting ? "Submitting…" : "Submit exam"} busy={submitting} onPress={confirmSubmit} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.navy },
  centreText: { color: colors.white, fontWeight: "600" },
  title: { color: colors.navy, fontSize: 18, fontWeight: "800" },
  score: { color: colors.navy, fontSize: 34, fontWeight: "900", marginTop: 6 },
  scorePct: { color: colors.muted, fontSize: 15, fontWeight: "700", marginTop: -4 },
  bar: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  barLeft: { flex: 1 },
  barTitle: { color: colors.white, fontSize: 16, fontWeight: "800" },
  barMeta: { color: "#C3D3E6", fontSize: 12, marginTop: 2 },
  timer: { backgroundColor: "#FFFFFF1F", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  timerLow: { backgroundColor: colors.danger },
  timerText: { color: colors.gold, fontWeight: "900", fontSize: 16, fontVariant: ["tabular-nums"] },
  timerTextLow: { color: colors.white },
  strike: { backgroundColor: colors.dangerSoft, color: colors.danger, fontWeight: "700", fontSize: 13, padding: 12, lineHeight: 18 },
  qMarks: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  qText: { color: colors.ink, fontSize: 17, fontWeight: "600", lineHeight: 25 },
  textArea: { height: 160, paddingTop: 12, paddingBottom: 12 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 14 },
  optionOn: { borderColor: colors.navy, backgroundColor: "#F2F6FB" },
  optionText: { color: colors.ink, fontSize: 15, flex: 1, lineHeight: 21 },
  optionTextOn: { fontWeight: "700", color: colors.navy },
  tick: { height: 24, width: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  tickOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  tickText: { color: colors.white, fontWeight: "900", fontSize: 13 },
  tickTextOn: { color: colors.white },
  nav: { flexDirection: "row", gap: 12 },
  navBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  navOff: { opacity: 0.4 },
  navText: { color: colors.navy, fontWeight: "800" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dot: { height: 34, width: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: colors.navy, borderColor: colors.navy },
  dotCurrent: { borderColor: colors.gold, borderWidth: 2 },
  dotText: { color: colors.ink, fontWeight: "700", fontSize: 12 },
  dotTextDone: { color: colors.white },
  pressed: { opacity: 0.75 },
});
