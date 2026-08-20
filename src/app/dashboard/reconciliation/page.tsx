"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, today } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Plus, ArrowLeftRight, CheckCircle, Link2, Trash2 } from "lucide-react";
import type { BankTransaction, IncomeEntry, ExpenseEntry } from "@/lib/types";

interface SuggestedMatch {
  bankTxn: BankTransaction;
  candidates: Array<{ id: string; ref: string; amount: number; date: string; description: string; type: "income" | "expense" }>;
  selectedId: string;
}

export default function ReconciliationPage() {
  const { canEdit, profile } = useAuth();
  const supabase = createClient();
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>([]);
  const [income, setIncome] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [btRes, incRes, expRes] = await Promise.all([
      supabase.from("bank_transactions").select("*").order("date", { ascending: false }),
      supabase.from("income_entries").select("*").eq("reconciled", false).order("date", { ascending: false }),
      supabase.from("expense_entries").select("*").eq("reconciled", false).order("date", { ascending: false }),
    ]);
    setBankTxns(btRes.data ?? []);
    setIncome(incRes.data ?? []);
    setExpenses(expRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function getSuggestions() {
    const unmatchedTxns = bankTxns.filter(bt => bt.match_status !== "matched");
    const matches: SuggestedMatch[] = unmatchedTxns.map(bt => {
      const isIn = bt.direction === "Money In";
      const pool = isIn
        ? income.map(e => ({ id: e.id, ref: e.receipt_no, amount: e.amount, date: e.date, description: `${e.student_name || ""} — ${e.category}`, type: "income" as const }))
        : expenses.map(e => ({ id: e.id, ref: e.voucher_no, amount: e.amount, date: e.date, description: `${e.vendor_name || ""} — ${e.category}`, type: "expense" as const }));
      // Score: exact amount match first, then close
      const candidates = pool
        .map(c => ({ ...c, score: c.amount === bt.amount ? 100 : Math.abs(c.amount - bt.amount) < bt.amount * 0.05 ? 80 : 0 }))
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return { bankTxn: bt, candidates, selectedId: candidates[0]?.id ?? "" };
    });
    setSuggestions(matches);
    setShowSuggestions(true);
  }

  async function confirmMatches() {
    const toConfirm = suggestions.filter(s => s.selectedId);
    for (const match of toConfirm) {
      const candidate = match.candidates.find(c => c.id === match.selectedId);
      if (!candidate) continue;
      // Update bank transaction
      await supabase.from("bank_transactions").update({
        match_status: "matched",
        matched_income_id: candidate.type === "income" ? candidate.id : null,
        matched_expense_id: candidate.type === "expense" ? candidate.id : null,
        updated_at: new Date().toISOString(),
      }).eq("id", match.bankTxn.id);
      // Mark ledger entry reconciled
      if (candidate.type === "income") {
        await supabase.from("income_entries").update({ reconciled: true, updated_at: new Date().toISOString() }).eq("id", candidate.id);
      } else {
        await supabase.from("expense_entries").update({ reconciled: true, updated_at: new Date().toISOString() }).eq("id", candidate.id);
      }
    }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Reconcile", details: `${toConfirm.length} matches confirmed`,
    });
    setShowSuggestions(false);
    setSuggestions([]);
    load();
  }

  async function deleteBankTxn(id: string) {
    await supabase.from("bank_transactions").delete().eq("id", id);
    setBankTxns(prev => prev.filter(b => b.id !== id));
  }

  const unmatched = bankTxns.filter(b => b.match_status !== "matched");
  const matched = bankTxns.filter(b => b.match_status === "matched");

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Reconciliation" subtitle="Match bank statement lines against your ledger entries">
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={getSuggestions} disabled={unmatched.length === 0}>
              <Link2 size={14} /> Get Suggestions
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Bank Line
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Bank Lines</div>
          <div className="text-xl font-bold text-[#0F2A47]">{bankTxns.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Unmatched</div>
          <div className="text-xl font-bold text-amber-700">{unmatched.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Matched</div>
          <div className="text-xl font-bold text-green-700">{matched.length}</div>
        </div>
      </div>

      {/* Suggestions modal */}
      {showSuggestions && (
        <Modal open onClose={() => setShowSuggestions(false)} title="Suggested Matches" size="xl">
          <div className="space-y-4">
            {suggestions.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">No matching candidates found.</p>
            ) : (
              suggestions.map((s, i) => (
                <div key={s.bankTxn.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-semibold text-sm">{s.bankTxn.description}</span>
                      <span className="text-gray-400 text-xs ml-2">{fmtDate(s.bankTxn.date)}</span>
                    </div>
                    <span className={cn("font-bold text-sm", s.bankTxn.direction === "Money In" ? "text-green-700" : "text-red-700")}>
                      {s.bankTxn.direction === "Money In" ? "+" : "-"}{fmtMoney(s.bankTxn.amount)}
                    </span>
                  </div>
                  {s.candidates.length === 0 ? (
                    <p className="text-xs text-gray-400">No candidates found for this amount.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-500 mb-1">Match with:</div>
                      {s.candidates.map(c => (
                        <label key={c.id} className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          s.selectedId === c.id ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 hover:border-gray-200"
                        )}>
                          <input type="radio" name={`match-${i}`} value={c.id}
                            checked={s.selectedId === c.id}
                            onChange={() => setSuggestions(prev => prev.map((m, j) => j === i ? { ...m, selectedId: c.id } : m))}
                            className="accent-[#C9A227]" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{c.ref}</div>
                            <div className="text-xs text-gray-500 truncate">{c.description}</div>
                          </div>
                          <div className={cn("font-semibold text-sm shrink-0", c.type === "income" ? "text-green-700" : "text-red-700")}>
                            {fmtMoney(c.amount)}
                          </div>
                        </label>
                      ))}
                      <label className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        !s.selectedId ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 hover:border-gray-200"
                      )}>
                        <input type="radio" name={`match-${i}`} value=""
                          checked={!s.selectedId}
                          onChange={() => setSuggestions(prev => prev.map((m, j) => j === i ? { ...m, selectedId: "" } : m))}
                          className="accent-[#C9A227]" />
                        <span className="text-sm text-gray-500">Skip (no match)</span>
                      </label>
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowSuggestions(false)}>Cancel</Button>
              <Button variant="gold" onClick={confirmMatches}>Confirm & Save Matches</Button>
            </div>
          </div>
        </Modal>
      )}

      {loading ? <LoadingSpinner /> : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Bank Statement Lines ({bankTxns.length})</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0F2A47] text-white">
                    <th className="text-left px-4 py-3 text-xs font-semibold">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Description</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Direction</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Matched To</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {bankTxns.length === 0 ? (
                    <tr><td colSpan={7}><EmptyState message="No bank lines added yet. Add lines from your bank statement." icon={<ArrowLeftRight size={32} />} /></td></tr>
                  ) : (
                    bankTxns.map(bt => (
                      <tr key={bt.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{fmtDate(bt.date)}</td>
                        <td className="px-4 py-3 font-medium max-w-[200px] truncate">{bt.description}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-xs font-semibold", bt.direction === "Money In" ? "text-green-700" : "text-red-700")}>
                            {bt.direction}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{fmtMoney(bt.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full",
                            bt.match_status === "matched" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          )}>
                            {bt.match_status === "matched" ? <CheckCircle size={11} /> : <ArrowLeftRight size={11} />}
                            {bt.match_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                          {bt.matched_income_id ? "Income entry" : bt.matched_expense_id ? "Expense entry" : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {canEdit && (
                            <button onClick={() => deleteBankTxn(bt.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Unreconciled ledger entries */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Unreconciled Income ({income.length})</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-2">
                {income.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">All income reconciled ✓</p> : (
                  income.slice(0, 8).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="text-sm font-mono font-semibold text-[#0F2A47]">{e.receipt_no}</div>
                        <div className="text-xs text-gray-500">{e.student_name || e.category} · {fmtDate(e.date)}</div>
                      </div>
                      <div className="font-semibold text-sm text-green-700">{fmtMoney(e.amount)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Unreconciled Expenses ({expenses.length})</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-2">
                {expenses.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">All expenses reconciled ✓</p> : (
                  expenses.slice(0, 8).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="text-sm font-mono font-semibold text-[#0F2A47]">{e.voucher_no}</div>
                        <div className="text-xs text-gray-500">{e.vendor_name || e.category} · {fmtDate(e.date)}</div>
                      </div>
                      <div className="font-semibold text-sm text-red-700">{fmtMoney(e.amount)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {showAdd && <AddBankLineModal onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddBankLineModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ date: today(), description: "", amount: "", direction: "Money In", reference: "", sender_name: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) { setError("Enter a valid amount."); return; }
    setLoading(true);
    const { error } = await supabase.from("bank_transactions").insert({
      date: form.date, description: form.description, amount: parseFloat(form.amount),
      direction: form.direction, reference: form.reference || null, sender_name: form.sender_name || null,
      match_status: "unmatched", source: "manual",
    });
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Add Bank Line", details: form.description });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add Bank Statement Line">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={form.date} onChange={set("date")} required />
          <Select label="Direction" value={form.direction} onChange={set("direction")}
            options={[{ value: "Money In", label: "Money In" }, { value: "Money Out", label: "Money Out" }]} />
          <div className="col-span-2"><Input label="Description" value={form.description} onChange={set("description")} required placeholder="e.g. TRF FROM A OKAFOR" /></div>
          <Input label="Amount (₦)" type="number" value={form.amount} onChange={set("amount")} min="0" step="0.01" required />
          <Input label="Reference (optional)" value={form.reference} onChange={set("reference")} placeholder="Bank ref. no." />
          <div className="col-span-2"><Input label="Sender Name (optional)" value={form.sender_name} onChange={set("sender_name")} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Add Line</Button>
        </div>
      </form>
    </Modal>
  );
}
