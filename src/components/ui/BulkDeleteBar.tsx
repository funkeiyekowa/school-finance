"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkDeleteBarProps {
  /** IDs currently selected */
  selectedIds: Set<string>;
  /** Total number of items in the current filtered view */
  totalCount: number;
  /** Label for the items, e.g. "income entries", "students" */
  itemLabel: string;
  /** Called to delete the selected IDs */
  onDeleteSelected: (ids: string[]) => Promise<void>;
  /** Called to delete ALL items (not just visible) */
  onDeleteAll: () => Promise<void>;
  /** Toggle select all in current view */
  onSelectAll: () => void;
  /** Clear selection */
  onClearSelection: () => void;
  /** Whether the user has developer permission */
  isDeveloper: boolean;
}

export function BulkDeleteBar({
  selectedIds, totalCount, itemLabel,
  onDeleteSelected, onDeleteAll, onSelectAll, onClearSelection, isDeveloper,
}: BulkDeleteBarProps) {
  const [confirmType, setConfirmType] = useState<"selected" | "all" | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!isDeveloper) return null;

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
      {/* Floating bar — only shows when items are selected OR as a subtle control strip */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-sm",
        count > 0
          ? "bg-red-50 border-red-200"
          : "bg-gray-50 border-gray-200"
      )}>
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

        {count > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="ghost" onClick={onClearSelection}>
              Clear
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmType("selected")}>
              <Trash2 size={13} /> Delete {count}
            </Button>
          </div>
        )}

        <div className={cn("ml-auto", count > 0 && "ml-0")}>
          <Button size="sm" variant="ghost" onClick={() => setConfirmType("all")}
            className="text-red-600 hover:bg-red-100 hover:text-red-700">
            <Trash2 size={13} /> Purge All {itemLabel}
          </Button>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirmType && (
        <Modal open onClose={() => setConfirmType(null)} title="⚠️ Confirm Deletion" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                {confirmType === "selected" ? (
                  <p>You are about to permanently delete <strong>{count} {itemLabel}</strong>. This cannot be undone.</p>
                ) : (
                  <p>You are about to permanently delete <strong>ALL {itemLabel}</strong> from the database. This is a full purge and cannot be undone.</p>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">This action is restricted to the developer role for test data cleanup.</p>
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

/** Checkbox for individual row selection */
export function RowCheckbox({
  id, selectedIds, onToggle, isDeveloper,
}: {
  id: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  isDeveloper: boolean;
}) {
  if (!isDeveloper) return null;
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
