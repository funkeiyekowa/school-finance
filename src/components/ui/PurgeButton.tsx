"use client";

/**
 * Super-admin-only "Purge All" button + confirmation modal.
 *
 * Use this on list pages that don't need row-multiselect but where we
 * still want a one-click "delete every row in this org" super-admin
 * escape hatch (staff directory, vendors, inventory, assets, library,
 * etc.). Renders nothing when `canPurge` is false.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Trash2, AlertTriangle } from "lucide-react";

interface PurgeButtonProps {
  itemLabel: string;                         // "vendors", "inventory items", ...
  canPurge: boolean;
  onPurge: () => Promise<void>;
  size?: "sm" | "md";
}

export function PurgeButton({ itemLabel, canPurge, onPurge, size = "sm" }: PurgeButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canPurge) return null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onPurge();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="ghost"
        onClick={() => setOpen(true)}
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 size={13} /> Purge All {itemLabel}
      </Button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title="⚠️ Confirm Purge" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <p>
                  You are about to permanently delete <strong>ALL {itemLabel}</strong>{" "}
                  in this organization. This is a full purge and cannot be undone.
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500">Purge is restricted to super-admins.</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="danger" loading={busy} onClick={handleConfirm}>Purge Everything</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
