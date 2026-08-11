"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiChevronLeft, FiChevronRight, FiEdit3, FiTrash2 } from "react-icons/fi";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { listEditableShipmentDrafts, type EditableShipmentDraft } from "@/lib/shipmentDrafts";
import { useDeleteShipmentDraft } from "@/lib/useDeleteShipmentDraft";

function formatCapitalized(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function draftLabel(draft: EditableShipmentDraft) {
  return formatCapitalized(draft.consigneeName) || "This shipment draft";
}

/**
 * Shipments started but never sent to the carrier.
 *
 * The Recent Shipments table below is built from carrier records, so a draft
 * that was abandoned mid-booking appeared nowhere and could not be reopened or
 * cleared. This panel is the only place those are reachable.
 */
export default function ShipmentDraftsPanel({ branchId }: { branchId?: string }) {
  const [drafts, setDrafts] = useState<EditableShipmentDraft[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Identifies the list currently being asked for. Loading is derived by
  // comparing it with the last one that finished, so the effect never has to set
  // state synchronously just to raise a spinner.
  const requestKey = `${branchId ?? ""}|${page}|${refreshKey}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== requestKey;

  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);
  const { requestDelete, dialog } = useDeleteShipmentDraft({ actor: "admin", onChanged: reload });

  // A branch change resets to the first page, or the list can land on a page
  // that no longer exists for the new filter. Adjusted during render rather than
  // in an effect so the reset is applied before anything is fetched.
  const [lastBranchId, setLastBranchId] = useState(branchId);
  if (lastBranchId !== branchId) {
    setLastBranchId(branchId);
    setPage(1);
  }

  useEffect(() => {
    let active = true;

    listEditableShipmentDrafts({ branchId, page, limit: 10 })
      .then((result) => {
        if (!active) return;
        setDrafts(result.drafts);
        setPagination(result.pagination);
        setError("");
      })
      .catch((caughtError: unknown) => {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment drafts.");
      })
      .finally(() => {
        // Marks this request as the one on screen. A superseded request leaves it
        // alone, so the spinner stays up until the newest one lands.
        if (active) setLoadedKey(requestKey);
      });

    return () => {
      active = false;
    };
  }, [branchId, page, refreshKey, requestKey]);

  // Nothing to resume and nothing went wrong: stay out of the way entirely.
  if (!loading && !error && drafts.length === 0) return null;

  return (
    <section className="mt-6 border border-slate-200 bg-white rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Drafts In Progress</h2>
          <p className="mt-1 text-xs text-slate-500">
            Shipments not yet booked. Continue where you left off, or delete the ones you no longer need.
          </p>
        </div>
        <p className="text-sm font-semibold text-slate-600">{pagination.total} drafts</p>
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">AWB / Tracking No.</th>
              <th className="px-4 py-3">Consignee</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Parcels</th>
              <th className="px-4 py-3">Last Updated</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-medium text-slate-500">Loading drafts...</td>
              </tr>
            ) : drafts.map((draft) => (
              <tr key={draft.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-950">AWB Pending</p>
                  <p className="mt-1 text-xs text-slate-500">Assigned after booking</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">
                    {formatCapitalized(draft.consigneeName) || "Not set"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatCapitalized(draft.destination) || "Destination not set"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">
                    {formatCapitalized(draft.businessAccount.companyName) || "Not set"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{draft.branch.code || draft.branch.name}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">
                  {draft.parcelCount} ({draft.totalWeightKg.toFixed(2)} kg)
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-500">
                  {formatDashboardDateTime(draft.updatedAt ?? draft.createdAt ?? "")}
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-40 items-center justify-end gap-2">
                    <Link
                      href={`/dashboard/dpd-labels/${draft.id}`}
                      className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700"
                    >
                      <FiEdit3 aria-hidden="true" className="h-4 w-4" />Continue
                    </Link>
                    <button
                      type="button"
                      title="Delete draft"
                      aria-label="Delete draft"
                      onClick={() => requestDelete({ id: draft.id, label: draftLabel(draft) })}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-700 transition hover:border-red-600 hover:text-red-600"
                    >
                      <FiTrash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <p>Page {pagination.page} of {pagination.totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Previous page"
              aria-label="Previous page"
              disabled={pagination.page === 1 || loading}
              onClick={() => setPage(pagination.page - 1)}
              className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FiChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Next page"
              aria-label="Next page"
              disabled={pagination.page === pagination.totalPages || loading}
              onClick={() => setPage(pagination.page + 1)}
              className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FiChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {dialog}
    </section>
  );
}
