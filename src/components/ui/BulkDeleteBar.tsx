"use client";

/**
 * Bulk-delete + purge control strip.
 *
 * Two levels of destructive action:
 *   canDelete -> "Delete N selected" button + row checkboxes.
 *                Enabled for super_admin always, and for org admins on
 *                entities the super_admin has enabled via the Delete
 *                Permissions setup page.
 *   canPurge  -> "Purge All <items>" button. Super_admin only.
 *
 * The component renders nothing when both are false, so pages that
 * always want to render the checkbox column can safely mount it -- the
 * bar collapses to null and RowCheckbox returns null.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkDeleteBarProps {
  selectedIds: Set<string>;
  totalCount: number;
  itemLabel: string;
  onDeleteSelected: (ids: string[]) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** May delete selected rows. Super_admin always, admin when permitted. */
  canDelete: boolean;
  /** May purge every row (super_admin only). */
  canPurge: boolean;
}

export function BulkDeleteBar({
  selectedIds, totalCount, itemLabel,
  onDeleteSelected, onDeleteAll, onSelectAll, onClearSelection,
  canDelete, canPurge,
}: BulkDeleteBarProps) {
  const [confirmType, setConfirmType] = useState<"selected" | "all" | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!canDelete && !canPurge) return null;

  const count = selectedIds.size;

  async function handleConfirm() {
    setDeleting(true);
    try {
      if (confirmType === "selected") {
        await onDeleteSelected(Array.from(selectedIds));
      } else {
        await onDeleteAll();
      }
    } finally {
      setDeleting(false);
      setConfirmType(null);
      onClearSelection();
    }
  }

  return (
    <>
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-sm",
        count > 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
      )}>
        {canDelete && (
          <div className="flex items-center gap-2">
            <button
              onClick={count === totalCount ? onClearSelection : onSelectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#0F2A47] transition-colors"
            >
              <input
                type="checkbox"
                checked={count > 0 && count === totalCount}
                onChange={() => count === totalCount ? onClearSelection() : onSelectAll()}
                className="accent-[#0F2A47] w-3.5 h-3.5"
                readOnly
              />
              {count > 0 ? `${count} selected` : "Select all"}
            </button>
          </div>
        )}

        {canDelete && count > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="ghost" onClick={onClearSelection}>Clear</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmType("selected")}>
              <Trash2 size={13} /> Delete {count}
            </Button>
          </div>
        )}

        {canPurge && (
          <div className={cn("ml-auto", canDelete && count > 0 && "ml-0")}>
            <Button size="sm" variant="ghost" onClick={() => setConfirmType("all")}
              className="text-red-600 hover:bg-red-100 hover:text-red-700">
              <Trash2 size={13} /> Purge All {itemLabel}
            </Button>
          </div>
        )}
      </div>

      {confirmType && (
        <Modal open onClose={() => setConfirmType(null)} title="⚠️ Confirm Deletion" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                {confirmType === "selected" ? (
                  <p>You are about to permanently delete <strong>{count} {itemLabel}</strong>. This cannot be undone.</p>
                ) : (
                  <p>You are about to permanently delete <strong>ALL {itemLabel}</strong> in this organization. This is a full purge and cannot be undone.</p>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {confirmType === "all"
                ? "Purge is restricted to super-admins."
                : "Delete is restricted to super-admins and org admins with permission for this record type."}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmType(null)}>Cancel</Button>
              <Button variant="danger" loading={deleting} onClick={handleConfirm}>
                {confirmType === "all" ? "Purge Everything" : `Delete ${count} Records`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Row-level selection checkbox. Only renders when the caller may delete. */
export function RowCheckbox({
  id, selectedIds, onToggle, canDelete,
}: {
  id: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  canDelete: boolean;
}) {
  if (!canDelete) return null;
  return (
    <td className="px-2 py-3 w-8">
      <input
        type="checkbox"
        checked={selectedIds.has(id)}
        onChange={() => onToggle(id)}
        onClick={e => e.stopPropagation()}
        className="accent-[#0F2A47] w-3.5 h-3.5 cursor-pointer"
      />
    </td>
  );
}
