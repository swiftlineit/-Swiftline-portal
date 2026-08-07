"use client";

import { useDialog } from "@/lib/useDialog";

/**
 * Confirmation prompt for an action that cannot be undone from the same screen.
 *
 * Rendered only while open so the dialog hook can own focus. `tone` picks the
 * confirm button's colour: use "danger" for anything destructive so the
 * consequence reads before the label does.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  busyLabel,
  tone = "danger",
  onConfirm,
  onCancel
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  // Escape must not close the dialog mid-request, or the user is left unsure
  // whether the action went through.
  const dialogRef = useDialog<HTMLDivElement>(true, () => {
    if (!busy) onCancel();
  });

  const confirmClasses = tone === "danger"
    ? "bg-[#D71313] hover:bg-[#b30f0f] shadow-[#D71313]/20"
    : "bg-[#0D1282] hover:bg-[#0a0d63] shadow-[#0D1282]/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D1282]/30 px-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
      >
        <div className="rounded-t-2xl border-b border-slate-100 bg-[#EEEDED]/50 px-5 py-4">
          <h2 className="text-lg font-bold text-[#0D1282]">{title}</h2>
        </div>

        <div className="px-5 py-4 text-sm leading-6 text-slate-600">{description}</div>

        <div className="flex flex-wrap justify-end gap-3 rounded-b-2xl border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${confirmClasses}`}
          >
            {busy ? busyLabel ?? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
