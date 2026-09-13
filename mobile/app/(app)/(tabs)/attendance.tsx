import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, PrimaryButton, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import {
  fetchCaptureConfig,
  fetchClasses,
  fetchExistingRecords,
  fetchStatuses,
  fetchStudents,
  fetchSubjects,
  saveAttendance,
  todayIso,
} from "@/lib/attendance-service";
import {
  DEFAULT_CAPTURE_CONFIG,
  SESSIONS,
  canCaptureAttendance,
  type CaptureConfig,
  type ClassRow,
  type StatusRow,
  type StudentRow,
  type SubjectRow,
} from "@/lib/attendance-types";

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.chipPressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function AttendanceScreen() {
  const { identity } = useAuth();

  const [config, setConfig] = useState<CaptureConfig>(DEFAULT_CAPTURE_CONFIG);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});

  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [session, setSession] = useState("full_day");

  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = identity?.role ?? "";
  const userId = identity?.userId ?? "";
  const selectedClass = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId]);
  const defaultStatus = useMemo(
    () => statuses.find((s) => s.is_default)?.code ?? statuses[0]?.code ?? "present",
    [statuses],
  );

  const loadBase = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [cfg, cls, sts] = await Promise.all([fetchCaptureConfig(), fetchClasses(role, userId), fetchStatuses()]);
      setConfig(cfg);
      setClasses(cls);
      setStatuses(sts);
      setSession((current) => (current === "full_day" ? cfg.default_session : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load attendance setup.");
    } finally {
      setLoading(false);
    }
  }, [role, userId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  // Subjects follow the selected class.
  useEffect(() => {
    setSubjectId("");
    setSubjects([]);
    if (!selectedClass || !config.subject_attendance_enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await fetchSubjects(selectedClass.id, selectedClass.organization_id, role, userId);
        if (cancelled) return;
        setSubjects(found);
        if (config.default_attendance_mode === "subject" && found.length > 0) setSubjectId(found[0].id);
      } catch {
        if (!cancelled) setSubjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClass, config.subject_attendance_enabled, config.default_attendance_mode, role, userId]);

  // Roster + any already-saved marks for this date/session/subject.
  const loadRoster = useCallback(async () => {
    if (!selectedClass) {
      setStudents([]);
      setMarks({});
      return;
    }
    setRosterLoading(true);
    setError(null);
    try {
      const roster = await fetchStudents(selectedClass);
      setStudents(roster);
      const existing = roster.length
        ? await fetchExistingRecords({ classId: selectedClass.id, date, session, subjectId: subjectId || null })
        : [];
      const next: Record<string, string> = {};
      for (const s of roster) {
        next[s.id] = existing.find((r) => r.student_id === s.id)?.status_code ?? defaultStatus;
      }
      setMarks(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the roster.");
      setStudents([]);
      setMarks({});
    } finally {
      setRosterLoading(false);
    }
  }, [selectedClass, date, session, subjectId, defaultStatus]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function onSave() {
    if (!selectedClass || students.length === 0) return;
    if (config.subject_required_for_attendance && config.subject_attendance_enabled && !subjectId) {
      setError("Select a subject before saving — your school requires subject-level attendance.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAttendance({
        classId: selectedClass.id,
        subjectId: subjectId || null,
        date,
        session,
        marks: students.map((s) => ({ student_id: s.id, status_code: marks[s.id] || defaultStatus })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await loadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save attendance.");
    } finally {
      setSaving(false);
    }
  }

  function markAll(code: string) {
    const next: Record<string, string> = {};
    for (const s of students) next[s.id] = code;
    setMarks(next);
  }

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of students) {
      const code = marks[s.id] || defaultStatus;
      counts[code] = (counts[code] ?? 0) + 1;
    }
    return counts;
  }, [students, marks, defaultStatus]);

  if (!identity) return null;

  if (!canCaptureAttendance(identity.role)) {
    return (
      <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
        <Card>
          <Text style={styles.cardTitle}>Attendance</Text>
          <Text style={ui.muted}>
            Your role does not capture class attendance. Viewing your own attendance record is coming in a later update.
          </Text>
        </Card>
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const canSave = Boolean(selectedClass) && students.length > 0 && !rosterLoading && !saving;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadBase()} tintColor={colors.navy} />}
      keyboardShouldPersistTaps="handled"
    >
      {error ? <Text style={ui.error}>{error}</Text> : null}

      <SectionTitle title="Class" />
      {classes.length === 0 ? (
        <Card>
          <Text style={ui.muted}>
            You have no classes assigned yet. Ask your school administrator to assign your classes, then pull down to
            refresh.
          </Text>
        </Card>
      ) : (
        <View style={styles.chipWrap}>
          {classes.map((c) => (
            <Chip key={c.id} label={c.short_code || c.name} selected={c.id === classId} onPress={() => setClassId(c.id)} />
          ))}
        </View>
      )}

      {selectedClass && config.subject_attendance_enabled && subjects.length > 0 ? (
        <>
          <SectionTitle title={config.subject_required_for_attendance ? "Subject (required)" : "Subject"} />
          <View style={styles.chipWrap}>
            {config.class_level_attendance_enabled && !config.subject_required_for_attendance ? (
              <Chip label="Whole class" selected={subjectId === ""} onPress={() => setSubjectId("")} />
            ) : null}
            {subjects.map((s) => (
              <Chip key={s.id} label={s.short_code || s.name} selected={s.id === subjectId} onPress={() => setSubjectId(s.id)} />
            ))}
          </View>
        </>
      ) : null}

      {selectedClass ? (
        <>
          <SectionTitle title="Date" />
          <View style={styles.dateRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setDate(shiftDate(date, -1))} style={styles.dateArrow}>
              <Text style={styles.dateArrowText}>‹</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setDate(todayIso())} style={styles.dateCentre}>
              <Text style={styles.dateText}>{prettyDate(date)}</Text>
              {date !== todayIso() ? <Text style={styles.dateHint}>Tap for today</Text> : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next day"
              disabled={date >= todayIso()}
              onPress={() => setDate(shiftDate(date, 1))}
              style={[styles.dateArrow, date >= todayIso() && styles.dateArrowOff]}
            >
              <Text style={styles.dateArrowText}>›</Text>
            </Pressable>
          </View>

          {config.period_selection_enabled ? (
            <View style={styles.chipWrap}>
              {SESSIONS.map((s) => (
                <Chip key={s.value} label={s.label} selected={s.value === session} onPress={() => setSession(s.value)} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {selectedClass ? (
        <>
          <SectionTitle
            title={`Students${students.length ? ` (${students.length})` : ""}`}
            action={
              statuses.length > 0 && students.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => markAll(defaultStatus)}>
                  <Text style={styles.linkText}>Mark all {statuses.find((s) => s.code === defaultStatus)?.label ?? "present"}</Text>
                </Pressable>
              ) : undefined
            }
          />

          {rosterLoading ? (
            <View style={styles.centreInline}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : students.length === 0 ? (
            <Card>
              <Text style={ui.muted}>No active students found for this class.</Text>
            </Card>
          ) : (
            <>
              {students.map((s) => (
                <Card key={s.id}>
                  <Text style={styles.studentName}>{s.full_name}</Text>
                  {s.student_code ? <Text style={styles.studentCode}>{s.student_code}</Text> : null}
                  <View style={styles.statusRow}>
                    {statuses.map((st) => {
                      const on = (marks[s.id] || defaultStatus) === st.code;
                      return (
                        <Pressable
                          key={st.code}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => setMarks((m) => ({ ...m, [s.id]: st.code }))}
                          style={({ pressed }) => [styles.status, on && styles.statusOn, pressed && styles.chipPressed]}
                        >
                          <Text style={[styles.statusText, on && styles.statusTextOn]}>{st.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Card>
              ))}

              <Card>
                <Text style={styles.cardTitle}>Summary</Text>
                <Text style={ui.muted}>
                  {statuses
                    .filter((s) => tally[s.code])
                    .map((s) => `${s.label}: ${tally[s.code]}`)
                    .join("   ") || "No students marked."}
                </Text>
              </Card>

              {saved ? <Text style={styles.saved}>Attendance saved.</Text> : null}
              <PrimaryButton label={saving ? "Saving…" : "Save attendance"} busy={saving} disabled={!canSave} onPress={() => void onSave()} />
            </>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  centreInline: { paddingVertical: 24, alignItems: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipPressed: { opacity: 0.75 },
  chipText: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: colors.white },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dateArrow: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  dateArrowOff: { opacity: 0.4 },
  dateArrowText: { fontSize: 24, color: colors.navy, fontWeight: "800", lineHeight: 28 },
  dateCentre: { flex: 1, alignItems: "center" },
  dateText: { fontSize: 16, fontWeight: "800", color: colors.navy },
  dateHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  linkText: { color: colors.navyMid, fontWeight: "700", fontSize: 13 },
  studentName: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  studentCode: { color: colors.muted, fontSize: 12, marginTop: -4 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  status: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvas },
  statusOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  statusText: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  statusTextOn: { color: colors.navy },
  saved: { color: colors.success, backgroundColor: colors.successSoft, borderColor: "#ABEFC6", borderWidth: 1, borderRadius: 10, padding: 12, fontWeight: "700", textAlign: "center" },
});
