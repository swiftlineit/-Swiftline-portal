"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiCheckCircle, FiDownload, FiMail, FiSearch, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import {
  POD_CENTRE_PATH,
  downloadPodPdf,
  emailPods,
  listPodCentre,
  podCentreParams,
  type PodCentreItem
} from "@/lib/podCentre";
import { useClientUser } from "@/lib/useClientUser";

/**
 * Every proof of delivery in one place.
 *
 * The per-shipment POD panel still exists and is the right place when you are
 * already looking at a shipment. This page answers the other question — the
 * month-end reconciliation, or the supplier asking whether a batch arrived —
 * which previously meant opening shipments one at a time.
 */
export default function ClientPodCentrePage() {
  const { user, loading } = useClientUser();
  const [pods, setPods] = useState<PodCentreItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dataLoading, setDataLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true);
    setError("");
    try {
      const result = await listPodCentre({ search, dateFrom, dateTo });
      setPods(result.pods);
      // Drop selections that fell outside the new filters, or the actions
      // would operate on PODs no longer on screen.
      setSelected((current) => {
        if (!current.size) return current;
        const visible = new Set(result.pods.map((pod) => pod.assignmentId));
        return new Set([...current].filter((id) => visible.has(id)));
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Proof of delivery could not be loaded.");
    } finally {
      setDataLoading(false);
    }
  }, [search, dateFrom, dateTo]);

  useEffect(() => {
    if (user) void Promise.resolve().then(load);
  }, [user, load]);

  // Applied once typing settles; this is a server-side search, not a filter
  // over the rows already fetched.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  if (loading || !user) return <ClientDashboardLoading />;

  const selectedIds = [...selected];
  const allSelected = pods.length > 0 && pods.every((pod) => selected.has(pod.assignmentId));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pods.map((pod) => pod.assignmentId)));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "That did not work."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">POD Centre</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every verified proof of delivery for your account. Search, download, or send them on.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <FiSearch aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={80}
            placeholder="Search AWB, parcel, recipient or consignee"
            className="h-10 w-72 rounded-xl border border-slate-300 bg-white pl-10 pr-9 text-sm outline-none focus:border-blue-900"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
            >
              <FiX aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <label className="text-xs font-semibold uppercase text-slate-500">Delivered</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <span className="text-sm text-slate-500">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        />
      </div>

      <div className="mb-3">
        <TableToolbar
          exportPath={POD_CENTRE_PATH}
          exportParams={podCentreParams({ search, dateFrom, dateTo })}
          exportName="proof-of-delivery"
        >
          {/* Bulk actions sit beside the export controls because they operate
              on the same selection the table above holds. */}
          <button
            type="button"
            disabled={busy || !pods.length}
            onClick={() => void run(() => downloadPodPdf({ assignmentIds: selectedIds, search, dateFrom, dateTo }))}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-blue-900 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
          >
            <FiDownload aria-hidden="true" className="h-4 w-4" />
            {selectedIds.length ? `Download ${selectedIds.length} POD${selectedIds.length === 1 ? "" : "s"}` : "Download all as PDF"}
          </button>
          <button
            type="button"
            disabled={busy || !selectedIds.length}
            onClick={() => void run(async () => {
              const result = await emailPods(selectedIds);
              toast.success(result.message);
            })}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FiMail aria-hidden="true" className="h-4 w-4" />
            Email POD
          </button>
        </TableToolbar>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={!pods.length}
                    aria-label="Select all proof of delivery on this page"
                    className="h-4 w-4 accent-[#0D1282]"
                  />
                </th>
                <th className="px-4 py-3">AWB</th>
                <th className="px-4 py-3">Consignee</th>
                <th className="px-4 py-3">Received by</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Evidence</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataLoading ? (
                <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-500">Loading proof of delivery…</td></tr>
              ) : !pods.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <FiCheckCircle aria-hidden="true" className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-800">
                      {search || dateFrom || dateTo ? "No proof of delivery matches these filters" : "No proof of delivery yet"}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                      {search || dateFrom || dateTo
                        ? "Clear the search or widen the date range to see the rest."
                        : "Once a shipment is delivered and the proof is verified by Swiftline, it appears here ready to download or forward."}
                    </p>
                  </td>
                </tr>
              ) : pods.map((pod) => (
                <tr key={pod.assignmentId} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(pod.assignmentId)}
                      onChange={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(pod.assignmentId)) next.delete(pod.assignmentId);
                        else next.add(pod.assignmentId);
                        return next;
                      })}
                      aria-label={`Select proof of delivery for ${pod.awb || pod.assignmentId}`}
                      className="h-4 w-4 accent-[#0D1282]"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{pod.awb || "AWB pending"}</p>
                    <p className="mt-1 text-xs text-slate-500">{pod.parcelNumbers.join(", ")}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{pod.consignee || "Not recorded"}</p>
                    <p className="mt-1 text-xs text-slate-500">{pod.destination}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {pod.recipientName || "Not recorded"}
                    {pod.recipientRelationship ? (
                      <span className="mt-1 block text-xs text-slate-500">{pod.recipientRelationship}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {pod.deliveredAt ? formatDashboardDateTime(pod.deliveredAt) : "Not recorded"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {pod.evidenceCount} file{pod.evidenceCount === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => downloadPodPdf({ assignmentIds: [pod.assignmentId] }))}
                        className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700 disabled:opacity-50"
                      >
                        <FiDownload aria-hidden="true" className="h-4 w-4" />
                        POD
                      </button>
                      <Link
                        href={`/client/shipments/${pod.shipmentDraftId}`}
                        className="font-semibold text-blue-900 hover:text-blue-700"
                      >
                        Shipment
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
