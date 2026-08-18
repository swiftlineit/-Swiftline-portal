"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiArchive, FiChevronDown, FiExternalLink, FiFileText, FiPlus, FiRefreshCw, FiSearch, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import CreateManifestDialog, { type ManifestDialogValues } from "@/components/shipments/CreateManifestDialog";
import DateRangeFilter from "@/components/ui/DateRangeFilter";
import { SortableHeader, TableToolbar, type TableColumnOption } from "@/components/ui/TableToolbar";
import { ScheduleChip } from "@/components/shipments/ShipmentJourney";
import { emptyDateRange } from "@/lib/dateRange";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { formatCsbType } from "@/lib/csbType";
import { createBulkShipmentManifest, manifestsHref } from "@/lib/shipmentManifests";
import { shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";
import {
  listShipments,
  shipmentDetailsHref,
  shipmentListParams,
  shipmentListPath,
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
  // Keyed by shipment id so a selection survives moving to another page - only
  // the rows on the page that was just (re)loaded are ever touched below.
  const [selected, setSelected] = useState<Map<string, ShipmentListItem>>(new Map());
  const [manifestFlowActive, setManifestFlowActive] = useState(false);
  const [status, setStatus] = useState("");
  /**
   * What is typed, and what has actually been searched for.
   *
   * Held apart so the list refetches once the typing settles rather than on
   * every keystroke- this is a server-side search across every page, not a
   * filter over the rows already on screen.
   */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState(emptyDateRange);
  const [page, setPage] = useState(1);
  // Newest booking first, the order this table has always opened in.
  const [sort, setSort] = useState("booked:desc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [lastManifestNumber, setLastManifestNumber] = useState("");

  const createShipmentHref = audience === "client" ? "/client/dpd-labels" : "/dashboard/dpd-labels";

  /**
   * Columns a customer may hide. AWB and Actions are locked: one identifies the
   * row and the other is how anything gets done with it, so a table without
   * them is not a shorter table, it is a broken one.
   */
  const columnOptions: TableColumnOption[] = [
    { key: "awb", label: "AWB / Shipment No.", locked: true },
    { key: "consignee", label: "Consignee" },
    { key: "route", label: "Route" },
    { key: "amount", label: "Chargeable Amount" },
    { key: "status", label: "Status" },
    { key: "eta", label: "Estimated Delivery" },
    { key: "created", label: "Created" },
    { key: "actions", label: "Actions", locked: true }
  ];
  const shows = (key: string) => !hiddenColumns.has(key);
  const [sortKey = "booked", sortDirection = "desc"] = sort.split(":");

  function applySort(key: string, direction: "asc" | "desc") {
    setSort(`${key}:${direction}`);
    // A reordered list has a different first page, so staying on page four
    // would show rows from the middle of the new order.
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listShipments(audience, { page, status, search, dateRange, sort });
      setShipments(data.shipments);
      setPagination(data.pagination);
      // Refresh or drop only the selections that belong to this page - a shipment
      // manifested elsewhere in the meantime is no longer eligible and falls out,
      // but selections on other pages are left untouched so they survive paging.
      setSelected((current) => {
        if (!current.size) return current;
        const next = new Map(current);
        for (const shipment of data.shipments) {
          if (!next.has(shipment.id)) continue;
          if (shipment.manifestEligible) next.set(shipment.id, shipment);
          else next.delete(shipment.id);
        }
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load shipments.");
    } finally {
      setLoading(false);
    }
  }, [audience, dateRange, page, search, sort, status]);

  // Deferred so the fetch's setState lands after the first paint rather than
  // cascading a render, matching the other listing screens.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Applies the typed term once typing settles, and returns to page one- the
  // page you were on rarely exists in a narrower result set.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch((current) => {
        if (current === searchInput.trim()) return current;
        setPage(1);
        return searchInput.trim();
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const selectable = useMemo(() => shipments.filter((shipment) => shipment.manifestEligible), [shipments]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const totals = useMemo(() => ({
    pieces: selectedList.reduce((sum, shipment) => sum + shipment.pieces, 0),
    weightKg: selectedList.reduce((sum, shipment) => sum + shipment.weightKg, 0)
  }), [selectedList]);

  // A manifest covers one business account and branch, so a mixed selection
  // cannot become one document.
  const mixedSelection = selectedList.length > 1 && selectedList.some((shipment) =>
    shipment.businessAccountId !== selectedList[0]?.businessAccountId
    || shipment.branchId !== selectedList[0]?.branchId);
  const allSelected = selectable.length > 0 && selectable.every((shipment) => selected.has(shipment.id));

  // Selects/deselects only the current page's eligible rows, leaving any
  // selections already made on other pages untouched.
  function toggleAll() {
    setSelected((current) => {
      const next = new Map(current);
      if (allSelected) {
        for (const shipment of selectable) next.delete(shipment.id);
      } else {
        for (const shipment of selectable) next.set(shipment.id, shipment);
      }
      return next;
    });
  }

  function toggleOne(shipment: ShipmentListItem) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(shipment.id)) next.delete(shipment.id);
      else next.set(shipment.id, shipment);
      return next;
    });
  }

  async function handleCreate(values: ManifestDialogValues) {
    setCreating(true);
    try {
      const shipmentDraftIds = [...selected.keys()];
      const result = await createBulkShipmentManifest({ shipmentDraftIds, ...values }, audience);
      toast.success(`Manifest ${result.manifest.manifestNumber} generated with ${shipmentDraftIds.length} `
        + `${shipmentDraftIds.length === 1 ? "shipment" : "shipments"}.`);
      setLastManifestNumber(result.manifest.manifestNumber);
      setDialogOpen(false);
      setSelected(new Map());
      setManifestFlowActive(false);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Manifest could not be generated.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-375">
      <div className="mb-5 flex flex-wrap flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
            <span className="sr-only">Search shipments</span>
            <div className="relative mt-2">
              <FiSearch aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                maxLength={80}
                placeholder="Search AWB, consignee or reference"
                className="h-10 w-64 rounded-xl border border-slate-300 bg-white pl-10 pr-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <FiX aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </label>

          <DateRangeFilter
            className="mt-2"
            value={dateRange}
            onChange={(value) => { setDateRange(value); setPage(1); }}
          />

          <label className="block">
            {/* <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span> */}
            <div className="relative mt-2">
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                className="h-10 w-56 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-11 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All Status</option>
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
       
          <Link
            href={manifestsHref(audience)}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-[#0D1282] bg-white px-4 text-sm font-semibold text-[#0D1282] hover:bg-[#0D1282]/5"
          >
            <FiArchive aria-hidden="true" className="h-4 w-4" />
            View All Manifests
          </Link>
          <button
            type="button"
            onClick={() => setManifestFlowActive((current) => !current)}
            className={`inline-flex h-10 items-center gap-2 rounded-4xl border px-4 text-sm font-semibold ${
              manifestFlowActive
                ? "border-[#0D1282] bg-[#0D1282]/5 text-[#0D1282]"
                : "border-[#0D1282] bg-white text-[#0D1282] hover:bg-[#0D1282]/5"
            }`}
          >
            <FiArchive aria-hidden="true" className="h-4 w-4" />
            Create Manifest
          </button>
          <Link
            href={createShipmentHref}
            className="inline-flex h-10 items-center gap-2 rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90"
          >
            <FiPlus aria-hidden="true" className="h-4 w-4" />
            Create New Shipment
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

      {manifestFlowActive ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1282]/25 bg-[#0D1282]/5 px-4 py-3">
          {selectedList.length ? (
            <>
              <div>
                <p className="text-sm font-semibold text-[#0D1282]">
                  {selectedList.length} {selectedList.length === 1 ? "shipment" : "shipments"} selected
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
                  onClick={() => setSelected(new Map())}
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
            </>
          ) : (
            <p className="text-sm font-semibold text-[#0D1282]">
              Select shipments below using the checkboxes, then create a manifest.
            </p>
          )}
        </div>
      ) : null}

      {/* Export carries the same filters as the table, built from one helper so
          a downloaded file can never disagree with what is on screen. */}
      <div className="mb-3">
        <TableToolbar
          exportPath={shipmentListPath(audience)}
          exportParams={shipmentListParams({ status, search, dateRange, sort })}
          exportName="shipments"
          rowCount={pagination.total}
          columns={columnOptions}
          hiddenColumns={hiddenColumns}
          onHiddenColumnsChange={setHiddenColumns}
        />
      </div>

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
                <th className="px-4 py-3">AWB / Shipment No.</th>
                {shows("consignee") ? <th className="px-4 py-3">Consignee</th> : null}
                {shows("route") ? <th className="px-4 py-3">Route</th> : null}
                {shows("amount") ? <th className="px-4 py-3">Chargeable Amount</th> : null}
                {shows("status") ? <th className="px-4 py-3">Status</th> : null}
                {/* The only sortable column on show. Consignee, Route, Amount
                    and Status cannot be ordered by the server- see
                    shipmentSortableColumns for why- so they stay plain
                    headings rather than arrows that reorder one page. */}
                {shows("eta") ? <th className="px-4 py-3">Estimated Delivery</th> : null}
                {shows("created") ? (
                  <SortableHeader
                    label="Created"
                    sortKey="booked"
                    active={sortKey === "booked"}
                    direction={sortDirection === "asc" ? "asc" : "desc"}
                    onSort={applySort}
                  />
                ) : null}
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => (
                <tr key={shipment.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(shipment.id)}
                      onChange={() => toggleOne(shipment)}
                      disabled={!shipment.manifestEligible}
                      aria-label={`Select shipment ${shipment.swiftlineTrackingNumber || shipment.id}`}
                      className="h-4 w-4 accent-[#0D1282] disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-950">
                      {shipment.swiftlineTrackingNumber || "AWB Pending"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>
                        {shipment.shipmentInvoice?.invoiceNumber
                          ? `Tax Invoice: ${shipment.shipmentInvoice.invoiceNumber}`
                          : "Tax Invoice Pending"}
                      </span>
                      {/* Customs route, so CSB-V shipments are identifiable at a glance. */}
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 font-semibold text-slate-600">
                        {formatCsbType(shipment.csbType)}
                      </span>
                    </p>
                  </td>
                  {shows("consignee") ? (
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{shipment.consignee || "Not set"}</p>
                      <p className="mt-1 text-xs text-slate-500">{shipment.destination || "Not set"}</p>
                    </td>
                  ) : null}
                  {shows("route") ? (
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{shipment.route}</p>
                      <p className="mt-1 text-xs text-slate-500">{shipment.branch.name || shipment.branch.code}</p>
                    </td>
                  ) : null}
                  {shows("amount") ? (
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{formatMoney(shipment)}</td>
                  ) : null}
                  {shows("status") ? (
                  <td className="px-4 py-3">
                    <span className="inline-flex py-1 text-xs font-semibold text-slate-700">
                      {shipment.statusLabel}
                    </span>
                    {/* A booking that reached the carrier but has not completed is
                        shown here rather than being hidden from this table. */}
                    {shipment.bookingStatus !== "LABEL_RECEIVED" ? (
                      <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {shipment.bookingStatusLabel}
                      </p>
                    ) : null}
                    {shipment.manifest ? (
                      <p className="mt-1 text-xs font-semibold text-[#0D1282]">
                        Manifest {shipment.manifest.manifestNumber}
                      </p>
                    ) : null}
                  </td>
                  ) : null}
                  {shows("eta") ? (
                    <td className="whitespace-nowrap px-4 py-3">
                      {shipment.deliveryEstimate ? (
                        <>
                          <p className="text-slate-800">
                            {formatDashboardDate(
                              shipment.deliveryEstimate.deliveredAt
                              ?? shipment.deliveryEstimate.estimatedDeliveryAt
                            )}
                          </p>
                          <div className="mt-1">
                            <ScheduleChip estimate={shipment.deliveryEstimate} />
                          </div>
                        </>
                      ) : (
                        // No route configured for this lane, so no date is
                        // claimed rather than one being invented.
                        <span className="text-slate-400">Not available</span>
                      )}
                    </td>
                  ) : null}
                  {shows("created") ? (
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDashboardDateTime(shipment.createdAt)}
                    </td>
                  ) : null}
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
                  {/* Counted rather than fixed at 8: hiding a column would
                      otherwise leave the empty message spanning past the table. */}
                  <td colSpan={3 + columnOptions.filter((column) => !column.locked && shows(column.key)).length} className="px-4 py-14 text-center text-slate-500">
                    No booked shipments found.
                  </td>
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
          shipmentCount={selectedList.length}
          totalPieces={totals.pieces}
          totalWeightKg={totals.weightKg}
          busy={creating}
          defaults={{
            origin: (selectedList[0]?.branch.city || selectedList[0]?.branch.name || "").toUpperCase(),
            destination: (selectedList[0]?.destinationCountry || "").toUpperCase(),
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
