import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";

interface PaginationProps {
  currentPage: number;
  pageCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  total: number;
  showing: number;
  limit: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onGoToPage?: (page: number) => void;
}

export function Pagination({
  currentPage,
  pageCount,
  hasNext,
  hasPrev,
  total,
  showing,
  limit,
  onNextPage,
  onPrevPage,
  onGoToPage,
}: PaginationProps) {
  const startRow = currentPage === 1 ? 1 : (currentPage - 1) * limit + 1;
  const endRow = Math.min(currentPage * limit, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
      <div className="flex items-center gap-4">
        <span>
          Showing <strong>{startRow}</strong> to <strong>{endRow}</strong> of{" "}
          <strong>{total}</strong> total
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasPrev}
          onClick={onPrevPage}
          className="gap-1"
        >
          <ChevronLeft size={14} /> Previous
        </Button>

        <div className="text-xs text-gray-500 px-2 py-1">
          Page <strong>{currentPage}</strong> of <strong>{pageCount}</strong>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={!hasNext}
          onClick={onNextPage}
          className="gap-1"
        >
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
