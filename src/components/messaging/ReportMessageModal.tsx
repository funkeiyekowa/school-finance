"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Message } from "@/lib/messaging/types";

const REASONS = ["Inappropriate content", "Bullying or harassment", "Spam", "Safeguarding concern", "Other"];

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  message: Message | null;
  onReported: () => void;
}

export function ReportMessageModal({ open, onClose, conversationId, message, onReported }: Props) {
  const supabase = createClient();
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("report_message", {
      p_conversation_id: conversationId, p_message_id: message?.id ?? null, p_reason: reason, p_details: details.trim() || null,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setDetails("");
    onClose();
    onReported();
  }

  return (
    <Modal open={open} onClose={onClose} title="Report this message" size="sm">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          A school administrator will review this. They can remove the message, lock the conversation, or restrict the sender.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Additional details (optional)</label>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={saving}>Submit report</Button>
        </div>
      </div>
    </Modal>
  );
}
