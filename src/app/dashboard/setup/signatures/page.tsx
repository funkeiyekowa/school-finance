"use client";

/**
 * /dashboard/setup/signatures
 *
 * Lets a school admin store multiple named e-signatures (Principal,
 * Bursar, HR Manager, ...) as small images, and pick which signature
 * -- if any -- is the default for each kind of printable letter
 * (Payslip, Report Card, Admission Letter, ...). Fully optional: a
 * letter type left unset keeps printing the existing blank
 * underline placeholder it always has, unchanged.
 *
 * Backed by supabase/signatures_and_class_teacher_module.sql:
 *   - letter_signatures (the stored images + names)
 *   - letter_signature_defaults (letter_type -> signature_id)
 *   - get_letter_signature(p_letter_type) / set_letter_signature_default(...)
 * Images are stored in the same "profile-photos" public bucket
 * already used for student/staff photos (org-prefix write, public
 * read) -- no new bucket needed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { compressImage } from "@/lib/photos/storage";
import { ArrowLeft, PenTool, Plus, Trash2, UploadCloud } from "lucide-react";

interface SignatureRow {
  id: string;
  label: string;
  signatory_name: string | null;
  signatory_title: string | null;
  image_url: string;
  active: boolean;
}

const LETTER_TYPES: { key: string; label: string }[] = [
  { key: "payslip", label: "Payslip" },
  { key: "report_card", label: "Report Card" },
  { key: "admission_letter", label: "Admission Letter" },
  { key: "enrollment_certificate", label: "Enrolment Certificate" },
  { key: "welcome_pack", label: "Welcome Pack" },
  { key: "expense_voucher", label: "Expense Voucher" },
];

const BUCKET = "profile-photos";

export default function SignaturesSettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { orgId, isOrgAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [signatures, setSignatures] = useState<SignatureRow[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({}); // letter_type -> signature_id
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newSignatoryName, setNewSignatoryName] = useState("");
  const [newSignatoryTitle, setNewSignatoryTitle] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [sigRes, defRes] = await Promise.all([
      supabase.from("letter_signatures").select("id, label, signatory_name, signatory_title, image_url, active")
        .eq("active", true).order("created_at"),
      supabase.from("letter_signature_defaults").select("letter_type, signature_id"),
    ]);
    setSignatures((sigRes.data as SignatureRow[]) ?? []);
    const map: Record<string, string> = {};
    for (const row of (defRes.data ?? []) as { letter_type: string; signature_id: string | null }[]) {
      if (row.signature_id) map[row.letter_type] = row.signature_id;
    }
    setDefaults(map);
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can manage letter signatures.</div>;
  }
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  async function addSignature() {
    if (!orgId) return;
    if (!newLabel.trim()) { setError("Give this signature a name, e.g. \"Principal\"."); return; }
    if (!newFile) { setError("Choose a signature image to upload."); return; }
    setSaving(true);
    setError(null);
    try {
      const compressed = await compressImage(newFile, 320, 0.9);
      const path = `${orgId}/signatures/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const { error: insErr } = await supabase.from("letter_signatures").insert({
        organization_id: orgId,
        label: newLabel.trim(),
        signatory_name: newSignatoryName.trim() || null,
        signatory_title: newSignatoryTitle.trim() || null,
        image_url: urlData.publicUrl,
      });
      if (insErr) throw new Error(insErr.message);

      setNewLabel(""); setNewSignatoryName(""); setNewSignatoryTitle(""); setNewFile(null);
      setShowAdd(false);
      setNotice("Signature added.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add signature.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSignature(s: SignatureRow) {
    if (!confirm(`Remove the "${s.label}" signature? Any letter types using it as their default will fall back to no signature.`)) return;
    const { error: delErr } = await supabase.from("letter_signatures").update({ active: false }).eq("id", s.id);
    if (delErr) { setError(delErr.message); return; }
    setNotice("Signature removed.");
    await load();
  }

  async function setDefaultFor(letterType: string, signatureId: string) {
    setError(null);
    const { error: rpcErr } = await supabase.rpc("set_letter_signature_default", {
      p_letter_type: letterType,
      p_signature_id: signatureId || null,
    });
    if (rpcErr) { setError(rpcErr.message); return; }
    setDefaults((prev) => {
      const next = { ...prev };
      if (signatureId) next[letterType] = signatureId; else delete next[letterType];
      return next;
    });
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <button
        onClick={() => router.push("/dashboard/setup")}
        className="text-xs text-gray-500 hover:text-[#0F2A47] flex items-center gap-1"
      >
        <ArrowLeft size={12} /> Back to Setup
      </button>

      <PageHeader
        title="Letter Signatures"
        subtitle="Store e-signatures and choose which one, if any, appears on each kind of printed letter."
        icon={<PenTool size={22} />}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      {/* Stored signatures */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Signatures ({signatures.length})</CardTitle>
            {!showAdd && (
              <Button size="sm" variant="gold" onClick={() => setShowAdd(true)}>
                <Plus size={14} /> Add signature
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAdd && (
            <div className="p-3 rounded-lg border border-gray-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name for this signature *" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Principal" />
                <Input label="Signatory's title" value={newSignatoryTitle} onChange={(e) => setNewSignatoryTitle(e.target.value)} placeholder="Principal" />
              </div>
              <Input label="Signatory's printed name" value={newSignatoryName} onChange={(e) => setNewSignatoryName(e.target.value)} placeholder="Mrs. Adeyemi Grace" />
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Signature image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#0F2A47] file:text-white hover:file:bg-[#1B3E63]"
                />
                <p className="text-[11px] text-gray-400 mt-1">A scanned or photographed signature on a plain background works best.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addSignature} loading={saving}>
                  <UploadCloud size={13} /> Save signature
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setError(null); }}>Cancel</Button>
              </div>
            </div>
          )}

          {signatures.length === 0 && !showAdd ? (
            <p className="text-sm text-gray-400 italic">No signatures added yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {signatures.map((s) => (
                <div key={s.id} className="p-2.5 rounded-lg border border-gray-200 text-center relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.image_url} alt={s.label} className="h-14 mx-auto object-contain mb-1.5" />
                  <p className="text-xs font-semibold text-[#0F2A47] truncate">{s.label}</p>
                  {s.signatory_name && <p className="text-[10px] text-gray-500 truncate">{s.signatory_name}</p>}
                  <button
                    onClick={() => removeSignature(s)}
                    className="absolute top-1 right-1 p-1 rounded bg-white border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove this signature"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-letter-type defaults */}
      <Card>
        <CardHeader><CardTitle>Which signature appears on each letter</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            Optional for every letter type. Leave a letter type set to &quot;None&quot; and it keeps
            printing a blank line for a signature to be added by hand, exactly as it does today.
          </p>
          {LETTER_TYPES.map((lt) => (
            <div key={lt.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700">{lt.label}</span>
              <select
                value={defaults[lt.key] ?? ""}
                onChange={(e) => setDefaultFor(lt.key, e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white min-w-[180px]"
              >
                <option value="">None</option>
                {signatures.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
