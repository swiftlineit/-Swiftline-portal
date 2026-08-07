"use client";

import { useCallback, useState } from "react";
import { toast } from "react-toastify";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  deleteShipmentDraft,
  restoreShipmentDraft,
  type ShipmentDraftActor
} from "@/lib/shipmentDrafts";

/** Enough of a draft to name it in the confirmation prompt. */
export type DeletableDraft = {
  id: string;
  label: string;
};

/**
 * Delete-a-draft flow: confirm, delete, then offer undo on the success toast.
 *
 * The undo exists because deletion is soft on the server for exactly this
 * reason — the draft is recoverable for a short window, and the toast is the
 * only place that window is exposed. Give the toast a long autoClose so the
 * undo is realistically reachable.
 */
export function useDeleteShipmentDraft(input: {
  actor: ShipmentDraftActor;
  onChanged: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState<DeletableDraft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { actor, onChanged } = input;

  const undo = useCallback(async (draftId: string) => {
    try {
      await restoreShipmentDraft(actor, draftId);
      toast.success("Shipment draft restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore this shipment draft.");
    }
    await onChanged();
  }, [actor, onChanged]);

  const confirmDelete = useCallback(async () => {
    if (!pending) return;

    setDeleting(true);
    try {
      await deleteShipmentDraft(actor, pending.id);
      const draftId = pending.id;
      setPending(null);

      toast.success(
        ({ closeToast }) => (
          <span className="flex items-center justify-between gap-3">
            <span>Shipment draft deleted.</span>
            <button
              type="button"
              onClick={() => {
                closeToast?.();
                void undo(draftId);
              }}
              className="shrink-0 font-semibold text-[#0D1282] underline underline-offset-2"
            >
              Undo
            </button>
          </span>
        ),
        { autoClose: 8000, closeOnClick: false }
      );

      await onChanged();
    } catch (error) {
      // Carries the server's reason — booked, manifested, on a pickup — which is
      // more useful than a generic failure, so it is shown as-is.
      toast.error(error instanceof Error ? error.message : "Unable to delete this shipment draft.");
      setPending(null);
    } finally {
      setDeleting(false);
    }
  }, [actor, onChanged, pending, undo]);

  const dialog = pending ? (
    <ConfirmDialog
      title="Delete shipment draft?"
      description={(
        <>
          <span className="font-semibold text-slate-900">{pending.label}</span> will be removed from
          your shipments. You can undo this straight after, and the invoice can be uploaded again to
          start a new draft.
        </>
      )}
      confirmLabel="Delete Draft"
      busyLabel="Deleting..."
      busy={deleting}
      onConfirm={confirmDelete}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { requestDelete: setPending, dialog, deleting };
}
