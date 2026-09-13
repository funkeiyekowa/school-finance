import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import {
  RANGE_OPTIONS,
  fetchAttendance,
  fetchClassNames,
  fetchLinkedStudents,
  fetchStatusMeta,
  prettyDate,
  rangeFor,
  sessionLabel,
  summarise,
  type AttendanceRecord,
  type LinkedStudent,
  type StatusMeta,
} from "@/lib/my-attendance-service";

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export default function MyAttendanceScreen() {
  const { identity } = useAuth();

  const [students, setStudents] = useState<LinkedStudent[]>([]);
  const [statuses, setStatuses] = useState<StatusMeta[]>([]);
  const [classNames, setClassNames] = useState<Map<string, string>>(new Map());
  const [studentId, setStudentId] = useState("");
  const [rangeKey, setRangeKey] = useState("30");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setError(null);
    try {
      const [linked, meta, names] = await Promise.all([fetchLinkedStudents(), fetchStatusMeta(), fetchClassNames()]);
      setStudents(linked);
      setStatuses(meta);
      setClassNames(names);
      setStudentId((prev) => (prev && linked.some((s) => s.id === prev) ? prev : (linked[0]?.id ?? "")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load attendance.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const loadRecords = useCallback(async () => {
    if (!studentId) {
      setRecords([]);
      return;
    }
    setLoadingRecords(true);
    setError(null);
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === rangeKey)?.days ?? 30;
      const { from, to } = rangeFor(days);
      setRecords(await fetchAttendance(studentId, from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load attendance records.");
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [studentId, rangeKey]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const summary = useMemo(() => summarise(records, statuses), [records, statuses]);
  const selected = students.find((s) => s.id === studentId) ?? null;
  const isParentView = students.length > 1 || identity?.role === "parent";

  if (!identity) return null;

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  if (students.length === 0) {
    return (
      <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
        {error ? <Text style={ui.error}>{error}</Text> : null}
        <Card>
          <Text style={styles.cardTitle}>No student record linked</Text>
          <Text style={ui.muted}>
            {identity.role === "parent"
              ? "No children are linked to your account yet, so there is no attendance to show. Ask your school administrator to link your child to your parent profile."
              : "This account is not linked to a student record, so there is no attendance to show. Ask your school administrator to check your profile."}
          </Text>
        </Card>
      </ScrollView>
    );
  }

  const rateColor =
    summary.ratePercent == null
      ? colors.muted
      : summary.ratePercent >= 90
        ? colors.success
        : summary.ratePercent >= 75
          ? colors.gold
          : colors.danger;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadBase();
            void loadRecords();
          }}
          tintColor={colors.navy}
        />
      }
    >
      {error ? <Text style={ui.error}>{error}</Text> : null}

      {students.length > 1 ? (
        <>
          <SectionTitle title="Child" />
          <View style={styles.chipWrap}>
            {students.map((s) => (
              <Chip
                key={s.id}
                label={s.fullName.split(" ")[0]}
                selected={s.id === studentId}
                onPress={() => setStudentId(s.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.hero}>
        <Text style={styles.heroName}>{selected?.fullName ?? ""}</Text>
        {selected?.grade || selected?.studentCode ? (
          <Text style={styles.heroMeta}>
            {[selected?.grade, selected?.studentCode].filter(Boolean).join("  ·  ")}
          </Text>
        ) : null}
        <Text style={[styles.rate, { color: rateColor }]}>
          {summary.ratePercent == null ? "—" : `${summary.ratePercent}%`}
        </Text>
        <Text style={styles.rateLabel}>
          {summary.ratePercent == null
            ? "No attendance recorded in this period"
            : `Attendance rate · ${summary.present} of ${summary.total} marked present`}
        </Text>
      </View>

      <View style={styles.chipWrap}>
        {RANGE_OPTIONS.map((r) => (
          <Chip key={r.key} label={r.label} selected={r.key === rangeKey} onPress={() => setRangeKey(r.key)} />
        ))}
      </View>

      {summary.byStatus.length > 0 ? (
        <Card>
          <Text style={styles.cardTitle}>Breakdown</Text>
          {summary.byStatus.map((s) => (
            <View key={s.code} style={styles.breakRow}>
              <Text style={styles.breakLabel}>{s.label}</Text>
              <Text style={styles.breakCount}>{s.count}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <SectionTitle title={isParentView ? "Recent records" : "My recent records"} />

      {loadingRecords ? (
        <View style={styles.inlineSpinner}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : records.length === 0 ? (
        <Card>
          <Text style={ui.muted}>
            No attendance was recorded in this period. Try a longer range, or check with the school if you expected
            records here.
          </Text>
        </Card>
      ) : (
        records.map((r) => {
          const meta = statuses.find((s) => s.code === r.statusCode);
          const present = meta?.isPresent ?? false;
          const isAbsent = r.statusCode.toLowerCase() === "absent";
          return (
            <Card key={r.id}>
              <View style={styles.recRow}>
                <View style={styles.recLeft}>
                  <Text style={styles.recDate}>{prettyDate(r.date)}</Text>
                  <Text style={ui.muted}>
                    {[sessionLabel(r.session), r.classId ? classNames.get(r.classId) : null].filter(Boolean).join("  ·  ")}
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    present ? styles.pillPresent : isAbsent ? styles.pillAbsent : styles.pillOther,
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      present ? styles.pillTextPresent : isAbsent ? styles.pillTextAbsent : styles.pillTextOther,
                    ]}
                  >
                    {meta?.label ?? r.statusCode}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  inlineSpinner: { paddingVertical: 24, alignItems: "center" },
  hero: { backgroundColor: colors.navy, borderRadius: 20, padding: 20, alignItems: "center", gap: 2 },
  heroName: { color: colors.white, fontSize: 18, fontWeight: "800" },
  heroMeta: { color: "#C3D3E6", fontSize: 12, fontWeight: "600" },
  rate: { fontSize: 44, fontWeight: "900", marginTop: 6 },
  rateLabel: { color: "#C3D3E6", fontSize: 12, textAlign: "center", lineHeight: 17 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: colors.white },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  breakRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  breakLabel: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  breakCount: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  recRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  recLeft: { flex: 1, gap: 2 },
  recDate: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },
  pillPresent: { backgroundColor: colors.successSoft, borderColor: "#ABEFC6" },
  pillAbsent: { backgroundColor: colors.dangerSoft, borderColor: "#FECDCA" },
  pillOther: { backgroundColor: colors.canvas, borderColor: colors.line },
  pillText: { fontSize: 12, fontWeight: "800" },
  pillTextPresent: { color: colors.success },
  pillTextAbsent: { color: colors.danger },
  pillTextOther: { color: colors.muted },
  pressed: { opacity: 0.75 },
});
