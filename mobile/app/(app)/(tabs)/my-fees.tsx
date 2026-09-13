import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import { fetchLinkedStudents, type LinkedStudent } from "@/lib/my-attendance-service";
import { fetchActiveFees, fetchPayments, fmtMoney, prettyDate, summariseChild, type ChildFeeSummary } from "@/lib/my-fees-service";

export default function MyFeesScreen() {
  const { identity } = useAuth();

  const [students, setStudents] = useState<LinkedStudent[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ChildFeeSummary>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const linked = await fetchLinkedStudents();
      setStudents(linked);
      if (linked.length === 0) {
        setSummaries({});
        return;
      }
      const ids = linked.map((s) => s.id);
      const [fees, payments] = await Promise.all([fetchActiveFees(), fetchPayments(ids)]);
      const next: Record<string, ChildFeeSummary> = {};
      for (const s of linked) {
        next[s.id] = summariseChild({ id: s.id, fullName: s.fullName, grade: s.grade }, fees, payments);
      }
      setSummaries(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load fees and payments.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const active = selectedId ? students.find((s) => s.id === selectedId) : students[0];
  const summary = active ? summaries[active.id] : null;

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

      {students.length === 0 ? (
        <Card>
          <Text style={styles.cardTitle}>No student record linked</Text>
          <Text style={ui.muted}>
            This account is not linked to a student record, so no fees or payments can be shown. Ask your school
            administrator to check your profile.
          </Text>
        </Card>
      ) : (
        <>
          {students.length > 1 ? (
            <View style={styles.chips}>
              {students.map((s) => {
                const isActive = (selectedId ?? students[0].id) === s.id;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Show fees for ${s.fullName}`}
                    onPress={() => setSelectedId(s.id)}
                    style={[styles.chip, isActive && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{s.fullName}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {summary ? (
            <>
              <View style={styles.summaryRow}>
                <Card>
                  <Text style={styles.summaryValue}>{fmtMoney(summary.totalDue)}</Text>
                  <Text style={ui.muted}>Total fees due</Text>
                </Card>
                <Card>
                  <Text style={[styles.summaryValue, styles.paid]}>{fmtMoney(summary.totalPaid)}</Text>
                  <Text style={ui.muted}>Total paid</Text>
                </Card>
              </View>

              <Card>
                <Text style={[styles.summaryValue, summary.balance > 0 ? styles.owed : styles.paid]}>
                  {fmtMoney(Math.abs(summary.balance))}
                </Text>
                <Text style={ui.muted}>{summary.balance > 0 ? "Outstanding balance" : "Credit"}</Text>
              </Card>

              <SectionTitle title="Recent payments" />
              <Card>
                {summary.payments.length === 0 ? (
                  <Text style={ui.muted}>No payments recorded yet.</Text>
                ) : (
                  summary.payments.map((p, i) => (
                    <View key={p.id} style={[styles.paymentRow, i > 0 && styles.paymentRowDivider]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.paymentReceipt}>{p.receiptNo}</Text>
                        <Text style={ui.muted}>
                          {prettyDate(p.date)} · {p.category}
                        </Text>
                      </View>
                      <Text style={styles.paymentAmount}>{fmtMoney(p.amount)}</Text>
                    </View>
                  ))
                )}
              </Card>

              <SectionTitle title="Fee schedule" />
              <Card>
                {summary.fees.length === 0 ? (
                  <Text style={ui.muted}>No fees have been published for this student&apos;s grade yet.</Text>
                ) : (
                  summary.fees.map((f, i) => (
                    <View key={f.id} style={[styles.feeRow, i > 0 && styles.paymentRowDivider]}>
                      <Text style={styles.feeName}>{f.name}</Text>
                      <Text style={styles.feeAmount}>{fmtMoney(f.amount)}</Text>
                    </View>
                  ))
                )}
              </Card>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: colors.white },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryValue: { color: colors.navy, fontSize: 20, fontWeight: "900" },
  paid: { color: colors.success },
  owed: { color: colors.danger },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  paymentRowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  paymentReceipt: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  paymentAmount: { color: colors.success, fontWeight: "800", fontSize: 14 },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  feeName: { color: colors.ink, fontSize: 14, flex: 1 },
  feeAmount: { color: colors.navy, fontWeight: "700", fontSize: 14 },
});
