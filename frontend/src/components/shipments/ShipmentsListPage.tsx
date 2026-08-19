"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiArchive, FiArrowDown, FiExternalLink, FiFileText, FiPlus, FiSearch, FiX } from "react-icons/fi";
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
  bulkUpdateDpdShipmentOperationalStatus,
  shipmentOperationalStatusOptions,
  type BulkShipmentStatusResult,
  type ShipmentOperationalStatus
} from "@/lib/dpdLabels";
import { listBusinessAccounts, type BusinessAccount } from "@/lib/businessAccounts";
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

function getAccountLabel(account: BusinessAccount) {
  return `${account.accountId} - ${account.company.companyName || account.contact.email}`;
}

/**
 * A shipment the operations user may push forward from the list. It must be a
 * completed booking, and it must not be on hold or cancelled- both are current
 * states, which is exactly what the list's `status` field holds (the newest
 * customer-visible event). Manifests and holds never block this, so the same-
 * day, same-flight shipments the bulk update exists for stay selectable.
 */
function isStatusUpdateEligible(shipment: ShipmentListItem) {
  return shipment.bookingStatus === "LABEL_RECEIVED"
    && shipment.status !== "ON_HOLD"
    && shipment.status !== "SHIPMENT_CANCELLED";
}

/**
 * The Shipments listing shared by the staff and client portals. It shows the same
 * columns as the Recent Shipments table on the Create Shipment page, plus a
 * selection column that feeds the bulk actions.
 *
 * Staff see two bulk actions. "Create Manifest" groups bookings into one
 * handover document. "Update Status" records the same operational status across
 * every selected shipment at once- the case where a day's bookings fly together
 * and move through the same stages together.
 */
export default function ShipmentsListPage({ audience }: { audience: ShipmentAudience }) {
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [pagination, setPagination] = useState<ShipmentListPagination>(emptyPagination);
  // Keyed by shipment id so a selection survives moving to another page - only
  // the rows on the page that was just (re)loaded are ever touched below.
  const [selected, setSelected] = useState<Map<string, ShipmentListItem>>(new Map());
  // Which bulk action the selection bar is serving, if any. Holds the two flows
  // apart: the manifest checks account/branch, the status update does not.
  const [activeFlow, setActiveFlow] = useState<"manifest" | "status" | null>(null);
  const [status, setStatus] = useState("");
  // Business-account filter, staff only. Clients are already scoped to the
  // accounts they belong to, so the dropdown would only ever offer one row.
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [bulkStatus, setBulkStatus] = useState<ShipmentOperationalStatus>("PARCEL_COLLECTED");
  const [bulkStatusNote, setBulkStatusNote] = useState("");
  const [bulkStatusLocation, setBulkStatusLocation] = useState("");
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);
  const [bulkStatusResult, setBulkStatusResult] = useState<BulkShipmentStatusResult | null>(null);
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
      const data = await listShipments(audience, { page, status, search, dateRange, businessAccountId, sort });
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
          const stillSelectable = shipment.manifestEligible || (audience === "admin" && isStatusUpdateEligible(shipment));
          if (stillSelectable) next.set(shipment.id, shipment);
          else next.delete(shipment.id);
        }
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load shipments.");
    } finally {
      setLoading(false);
    }
  }, [audience, businessAccountId, dateRange, page, search, sort, status]);

  // Deferred so the fetch's setState lands after the first paint rather than
  // cascading a render, matching the other listing screens.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The account list powers the staff filter. All accounts are shown, not just
  // active ones, so a suspended account's historical shipments stay findable.
  useEffect(() => {
    if (audience !== "admin") return;
    let mounted = true;
    listBusinessAccounts()
      .then((data) => { if (mounted) setAccounts(data.accounts); })
      .catch(() => { /* the filter stays empty; the table still loads */ });
    return () => { mounted = false; };
  }, [audience]);

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

  // Staff may select anything they could act on; a client's rows are still
  // gated on manifest eligibility because the manifest is their only action.
  const selectable = useMemo(() => shipments.filter((shipment) => (
    audience === "admin" ? shipment.manifestEligible || isStatusUpdateEligible(shipment) : shipment.manifestEligible
  )), [audience, shipments]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  // Each flow works from the subset of the selection it can actually act on, so
  // a mixed selection never sends an ineligible row to the other flow's API.
  const manifestSelection = useMemo(() => selectedList.filter((shipment) => shipment.manifestEligible), [selectedList]);
  const statusSelection = useMemo(() => selectedList.filter(isStatusUpdateEligible), [selectedList]);
  const manifestTotals = useMemo(() => ({
    pieces: manifestSelection.reduce((sum, shipment) => sum + shipment.pieces, 0),
    weightKg: manifestSelection.reduce((sum, shipment) => sum + shipment.weightKg, 0)
  }), [manifestSelection]);

  // A manifest covers one business account and branch, so a mixed selection
  // cannot become one document.
  const mixedSelection = manifestSelection.length > 1 && manifestSelection.some((shipment) =>
    shipment.businessAccountId !== manifestSelection[0]?.businessAccountId
    || shipment.branchId !== manifestSelection[0]?.branchId);
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
    const shipmentDraftIds = manifestSelection.map((shipment) => shipment.id);
    if (!shipmentDraftIds.length) {
      toast.error("Select at least one shipment that is eligible for a manifest.");
      return;
    }
    setCreating(true);
    try {
      const result = await createBulkShipmentManifest({ shipmentDraftIds, ...values }, audience);
      toast.success(`Manifest ${result.manifest.manifestNumber} generated with ${shipmentDraftIds.length} `
        + `${shipmentDraftIds.length === 1 ? "shipment" : "shipments"}.`);
      setLastManifestNumber(result.manifest.manifestNumber);
      setDialogOpen(false);
      setSelected(new Map());
      setActiveFlow(null);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Manifest could not be generated.");
    } finally {
      setCreating(false);
    }
  }

  async function handleBulkStatusUpdate() {
    const shipmentDraftIds = statusSelection.map((shipment) => shipment.id);
    if (!shipmentDraftIds.length) return;

    setBulkStatusBusy(true);
    setError("");
    try {
      const result = await bulkUpdateDpdShipmentOperationalStatus({
        shipmentDraftIds,
        status: bulkStatus,
        note: bulkStatusNote || "Bulk status update by Swiftline Operations",
        location: bulkStatusLocation
      });
      setBulkStatusResult(result);
      toast.success(result.message);
      setActiveFlow(null);
      setBulkStatusNote("");
      setBulkStatusLocation("");
      setSelected(new Map());
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The bulk status update could not be completed.");
    } finally {
      setBulkStatusBusy(false);
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
              : "All booked shipments across business accounts. Select one or more to update their status at once."}
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

          {audience === "admin" ? (
            <label className="block">
              <span className="sr-only">Filter by business account</span>
              <div className="relative mt-2">
                <select
                  value={businessAccountId}
                  onChange={(event) => { setBusinessAccountId(event.target.value); setPage(1); }}
                  className="h-10 w-64 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">All Business Accounts</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account._id}>{getAccountLabel(account)}</option>
                  ))}
                </select>
                <FiArrowDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              </div>
            </label>
          ) : null}

          <label className="block">
            <div className="relative mt-2">
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                className="h-10 w-56 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All Status</option>
                {shipmentStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <FiArrowDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
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
            onClick={() => setActiveFlow((current) => current === "manifest" ? null : "manifest")}
            className={`inline-flex h-10 items-center gap-2 rounded-4xl border px-4 text-sm font-semibold ${
              activeFlow === "manifest"
                ? "border-[#0D1282] bg-[#0D1282]/5 text-[#0D1282]"
                : "border-[#0D1282] bg-white text-[#0D1282] hover:bg-[#0D1282]/5"
            }`}
          >
            <FiArchive aria-hidden="true" className="h-4 w-4" />
            Create Manifest
          </button>
          {audience === "admin" ? (
            <button
              type="button"
              onClick={() => setActiveFlow((current) => current === "status" ? null : "status")}
              className={`inline-flex h-10 items-center gap-2 rounded-4xl border px-4 text-sm font-semibold ${
                activeFlow === "status"
                  ? "border-[#0D1282] bg-[#0D1282]/5 text-[#0D1282]"
                  : "border-[#0D1282] bg-white text-[#0D1282] hover:bg-[#0D1282]/5"
              }`}
            >
              <FiArrowDown aria-hidden="true" className="h-4 w-4" />
              Update Status
            </button>
          ) : null}
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

      {bulkStatusResult ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-emerald-800">{bulkStatusResult.message}</p>
            <button
              type="button"
              onClick={() => setBulkStatusResult(null)}
              className="h-8 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Dismiss
            </button>
          </div>
          {bulkStatusResult.skipped.length ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Skipped - resolve these before updating again
              </p>
              <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto text-sm text-slate-700">
                {bulkStatusResult.skipped.map((skip) => (
                  <li key={skip.shipmentDraftId} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold text-slate-900">
                      {skip.swiftlineTrackingNumber || skip.shipmentDraftId}
                    </span>
                    <span className="text-slate-600">{skip.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeFlow === "manifest" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1282]/25 bg-[#0D1282]/5 px-4 py-3">
          {manifestSelection.length ? (
            <>
              <div>
                <p className="text-sm font-semibold text-[#0D1282]">
                  {manifestSelection.length} {manifestSelection.length === 1 ? "shipment" : "shipments"} selected
                  {" · "}{manifestTotals.pieces} pcs · {manifestTotals.weightKg.toFixed(2)} kg
                </p>
                {selectedList.length > manifestSelection.length ? (
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    {selectedList.length - manifestSelection.length} selected {selectedList.length - manifestSelection.length === 1 ? "shipment is" : "shipments are"} not
                    manifest-eligible and will be left out.
                  </p>
                ) : null}
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
                  disabled={mixedSelection || !manifestSelection.length}
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

      {activeFlow === "status" ? (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[#0D1282]/25 bg-[#0D1282]/5 px-4 py-3">
          {statusSelection.length ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0D1282]">
                  Update {statusSelection.length} {statusSelection.length === 1 ? "shipment" : "shipments"} to a new status.
                </p>
                {selectedList.length > statusSelection.length ? (
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    {selectedList.length - statusSelection.length} selected {selectedList.length - statusSelection.length === 1 ? "shipment is" : "shipments are"} not
                    eligible (not booked, on hold or cancelled) and will be skipped.
                  </p>
                ) : null}
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Status</span>
                <div className="relative mt-1">
                  <select
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.target.value as ShipmentOperationalStatus)}
                    className="h-10 w-56 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
                  >
                    {shipmentOperationalStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <FiArrowDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Note <span className="font-normal normal-case text-slate-400">(optional)</span>
                </span>
                <input
                  value={bulkStatusNote}
                  onChange={(event) => setBulkStatusNote(event.target.value)}
                  placeholder="Shared note for these shipments"
                  className="mt-1 h-10 w-56 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Location <span className="font-normal normal-case text-slate-400">(optional)</span>
                </span>
                <input
                  value={bulkStatusLocation}
                  onChange={(event) => setBulkStatusLocation(event.target.value)}
                  maxLength={120}
                  placeholder="Delhi Hub"
                  title="Where this scan happened. Shown to the customer as the shipment's current location."
                  className="mt-1 h-10 w-56 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBulkStatusUpdate}
                  disabled={bulkStatusBusy}
                  className="h-10 rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {bulkStatusBusy ? "Updating..." : "Update Status"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFlow(null);
                    setBulkStatusNote("");
                    setBulkStatusLocation("");
                  }}
                  className="h-10 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-sm font-semibold text-[#0D1282]">
                Select shipments below using the checkboxes, then update their status at once.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveFlow(null);
                  setBulkStatusNote("");
                  setBulkStatusLocation("");
                }}
                className="h-9 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Export carries the same filters as the table, built from one helper so
          a downloaded file can never disagree with what is on screen. */}
      <div className="mb-3">
        <TableToolbar
          exportPath={shipmentListPath(audience)}
          exportParams={shipmentListParams({ status, search, dateRange, businessAccountId, sort })}
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
                      disabled={!shipment.manifestEligible && !(audience === "admin" && isStatusUpdateEligible(shipment))}
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
          shipmentCount={manifestSelection.length}
          totalPieces={manifestTotals.pieces}
          totalWeightKg={manifestTotals.weightKg}
          busy={creating}
          defaults={{
            origin: (manifestSelection[0]?.branch.city || manifestSelection[0]?.branch.name || "").toUpperCase(),
            destination: (manifestSelection[0]?.destinationCountry || "").toUpperCase(),
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