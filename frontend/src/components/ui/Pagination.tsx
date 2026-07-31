"use client";

/**
 * Previous/Next pager, styled to match the footer on the Shipments list page.
 */
export default function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-sm text-slate-600">
        Page {page} of {totalPages} · {total} total
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
