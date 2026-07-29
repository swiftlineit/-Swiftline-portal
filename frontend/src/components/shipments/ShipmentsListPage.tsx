"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiArchive, FiChevronDown, FiExternalLink, FiFileText, FiPlus, FiRefreshCw } from "react-icons/fi";
import { toast } from "react-toastify";
import CreateManifestDialog, { type ManifestDialogValues } from "@/components/shipments/CreateManifestDialog";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { createBulkShipmentManifest, manifestsHref } from "@/lib/shipmentManifests";
import { shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";
import {
  listShipments,
  shipmentDetailsHref,
  shipmentStatusOptions,
  type ShipmentAudience,
  type ShipmentListItem,
  type ShipmentListPagination
} from "@/lib/shipmentsList";

const emptyPagination: ShipmentListPagination = { page: 1, limit: 20, total: 0, totalPages: 1 };

function formatMoney(shipment: ShipmentListItem) {
  if (!shipment.shipmentInvoice) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: shipment.shipmentInvoice.currency,
    minimumFractionDigits: 2
  }).format(shipment.shipmentInvoice.chargeableAmountMinor / 100);
}

/**
 * The Shipments listing shared by the staff and client portals. It shows the same
 * columns as the Recent Shipments table on the Create Shipment page, plus a
 * selection column that feeds the bulk manifest action.
 */
export default function ShipmentsListPage({ audience }: { audience: ShipmentAudience }) {
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [pagination, setPagination] = useState<ShipmentListPagination>(emptyPagination);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [lastManifestNumber, setLastManifestNumber] = useState("");

  const createShipmentHref = audience === "client" ? "/client/dpd-labels" : "/dashboard/dpd-labels";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listShipments(audience, { page, status });
      setShipments(data.shipments);
      setPagination(data.pagination);
      // Rows that left the page can no longer be manifested from it.
      const visibleIds = new Set(data.shipments.map((shipment) => shipment.id));
      setSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load shipments.");
    } finally {
      setLoading(false);
    }
  }, [audience, page, status]);

  // Deferred so the fetch's setState lands after the first paint rather than
  // cascading a render, matching the other listing screens.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectable = useMemo(() => shipments.filter((shipment) => shipment.manifestEligible), [shipments]);
  const selected = useMemo(
    () => shipments.filter((shipment) => selectedIds.includes(shipment.id)),
    [selectedIds, shipments]
  );
  const totals = useMemo(() => ({
    pieces: selected.reduce((sum, shipment) => sum + shipment.pieces, 0),
    weightKg: selected.reduce((sum, shipment) => sum + shipment.weightKg, 0)
  }), [selected]);

  // A manifest covers one business account and branch, so a mixed selection
  // cannot become one document.
  const mixedSelection = selected.length > 1 && selected.some((shipment) =>
    shipment.businessAccountId !== selected[0]?.businessAccountId
    || shipment.branchId !== selected[0]?.branchId);
  const allSelected = selectable.length > 0 && selectable.every((shipment) => selectedIds.includes(shipment.id));

  function toggleAll() {
    setSelectedIds(allSelected ? [] : selectable.map((shipment) => shipment.id));
  }

  function toggleOne(shipmentId: string) {
    setSelectedIds((current) => current.includes(shipmentId)
      ? current.filter((id) => id !== shipmentId)
      : [...current, shipmentId]);
  }

  async function handleCreate(values: ManifestDialogValues) {
    setCreating(true);
    try {
      const result = await createBulkShipmentManifest({ shipmentDraftIds: selectedIds, ...values }, audience);
      toast.success(`Manifest ${result.manifest.manifestNumber} generated with ${selectedIds.length} `
        + `${selectedIds.length === 1 ? "shipment" : "shipments"}.`);
      setLastManifestNumber(result.manifest.manifestNumber);
      setDialogOpen(false);
      setSelectedIds([]);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Manifest could not be generated.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-[#0D1282]">Shipments</h1>
          <p className="mt-1 text-sm text-slate-500">
            {audience === "client"
              ? "Your booked shipments. Select one or more to generate a manifest."
              : "All booked shipments across business accounts."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter By Status</span>
            <div className="relative mt-2">
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                className="h-10 w-56 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-11 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All statuses</option>
                {shipmentStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <FiChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            title="Refresh"
            aria-label="Refresh shipments"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-[#0D1282] hover:border-[#0D1282]"
          >
            <FiRefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href={manifestsHref(audience)}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-[#0D1282] bg-white px-4 text-sm font-semibold text-[#0D1282] hover:bg-[#0D1282]/5"
          >
            <FiArchive aria-hidden="true" className="h-4 w-4" />
            View All Manifests
          </Link>
          <Link
            href={createShipmentHref}
            className="inline-flex h-10 items-center gap-2 rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90"
          >
            <FiPlus aria-hidden="true" className="h-4 w-4" />
            Create Shipment
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {lastManifestNumber ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">
            Manifest {lastManifestNumber} was generated successfully.
          </p>
          <Link
            href={manifestsHref(audience)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <FiArchive aria-hidden="true" className="h-4 w-4" />
            View All Manifests
          </Link>
        </div>
      ) : null}

      {selectedIds.length ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1282]/25 bg-[#0D1282]/5 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[#0D1282]">
              {selectedIds.length} {selectedIds.length === 1 ? "shipment" : "shipments"} selected
              {" · "}{totals.pieces} pcs · {totals.weightKg.toFixed(2)} kg
            </p>
            {mixedSelection ? (
              <p className="mt-1 text-xs font-semibold text-amber-700">
                A manifest covers one business account and branch. Narrow the selection to continue.
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="h-9 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              disabled={mixedSelection}
              className="h-9 rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Create Manifest
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={!selectable.length}
                    aria-label="Select all shipments on this page"
                    className="h-4 w-4 accent-[#0D1282]"
                  />
                </th>
                <th className="px-4 py-3">Shipment</th>
                <th className="px-4 py-3">Consignee</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Chargeable Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => (
                <tr key={shipment.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(shipment.id)}
                      onChange={() => toggleOne(shipment.id)}
                      disabled={!shipment.manifestEligible}
                      aria-label={`Select shipment ${shipment.shipmentReference || shipment.id}`}
                      className="h-4 w-4 accent-[#0D1282] disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-950">
                      {shipment.shipmentReference || shipment.swiftlineTrackingNumber || "Pending"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{shipment.invoiceNumber || shipment.serviceInfo}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{shipment.consignee || "Not set"}</p>
                    <p className="mt-1 text-xs text-slate-500">{shipment.destination || "Not set"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{shipment.route}</p>
                    <p className="mt-1 text-xs text-slate-500">{shipment.branch.name || shipment.branch.code}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{formatMoney(shipment)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex py-1 text-xs font-semibold text-slate-700">
                      {shipment.statusLabel}
                    </span>
                    {shipment.manifest ? (
                      <p className="mt-1 text-xs font-semibold text-[#0D1282]">
                        Manifest {shipment.manifest.manifestNumber}
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatDashboardDateTime(shipment.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={shipmentDetailsHref(audience, shipment.id)}
                        className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700"
                      >
                        <FiExternalLink aria-hidden="true" className="h-4 w-4" />View Details
                      </Link>
                      <Link
                        href={shipmentInvoicePageUrl(shipment.id, audience)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700"
                      >
                        <FiFileText aria-hidden="true" className="h-4 w-4" />Invoice
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !shipments.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-slate-500">No booked shipments found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-sm text-slate-600">
          Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
        </span>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => setPage((value) => value + 1)}
          className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {dialogOpen ? (
        <CreateManifestDialog
          shipmentCount={selected.length}
          totalPieces={totals.pieces}
          totalWeightKg={totals.weightKg}
          busy={creating}
          defaults={{
            origin: (selected[0]?.branch.city || selected[0]?.branch.name || "").toUpperCase(),
            destination: (selected[0]?.destinationCountry || "").toUpperCase(),
            coloader: "",
            paymentType: ""
          }}
          onCancel={() => setDialogOpen(false)}
          onConfirm={handleCreate}
        />
      ) : null}
    </div>
  );
}
