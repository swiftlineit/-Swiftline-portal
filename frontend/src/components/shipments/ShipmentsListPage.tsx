"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiArchive, FiArrowDown, FiExternalLink, FiFileText, FiPlus, FiSearch, FiTrash2, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import CreateManifestDialog, { type ManifestDialogValues } from "@/components/shipments/CreateManifestDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
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
  deleteBookedShipment,
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
 *
 * `role` is the signed-in portal role and is only read to decide whether the
 * per-row Delete action is offered. It is absent on the client portal, which
 * never shows it. The server enforces the same rule regardless of what is
 * rendered here.
 */
export default function ShipmentsListPage({ audience, role }: { audience: ShipmentAudience; role?: string }) {
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
  // The row awaiting delete confirmation. Held rather than a bare id so the
  // prompt can name the shipment the operator is about to remove.
  const [pendingDelete, setPendingDelete] = useState<ShipmentListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const createShipmentHref = audience === "client" ? "/client/dpd-labels" : "/dashboard/dpd-labels";
  // Staff table only, and only for an administrator. Operations and delivery
  // work this list daily but do not remove rows from it.
  const canDelete = audience === "admin" && role === "admin";

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

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result = await deleteBookedShipment(pendingDelete.id);
      toast.success(result.message || "Shipment deleted.");
      // Dropped from the selection too: a deleted row must not travel into a
      // manifest or a bulk status update on the next click.
      setSelected((current) => {
        if (!current.has(pendingDelete.id)) return current;
        const next = new Map(current);
        next.delete(pendingDelete.id);
        return next;
      });
      setPendingDelete(null);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The shipment could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-8xl ">
      <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-[#0D1282]">Shipments</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {audience === "client"
                ? "Your booked shipments. Select one or more to generate a manifest."
                : "All booked shipments across business accounts. Select one or more to update their status at once."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={manifestsHref(audience)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] transition hover:border-[#0D1282]/40 hover:bg-[#0D1282]/5"
            >
              <FiArchive aria-hidden="true" className="h-4 w-4" />
              View Manifests
            </Link>
            <Link
              href={createShipmentHref}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white transition hover:bg-[#0D1282]/90"
            >
              <FiPlus aria-hidden="true" className="h-4 w-4" />
              Create New Shipment
            </Link>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className={`grid gap-3 md:grid-cols-2 ${audience === "admin" ? "xl:grid-cols-[minmax(260px,1.3fr)_auto_minmax(220px,1fr)_minmax(180px,0.8fr)]" : "xl:grid-cols-[minmax(280px,1.4fr)_auto_minmax(200px,0.8fr)]"}`}>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search</span>
              <div className="relative">
                <FiSearch aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  maxLength={80}
                  placeholder="Search AWB, consignee or reference"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
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

            <div className="min-w-0">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date Range</span>
              <DateRangeFilter
                value={dateRange}
                onChange={(value) => { setDateRange(value); setPage(1); }}
              />
            </div>

            {audience === "admin" ? (
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Business Account</span>
                <div className="relative">
                  <select
                    value={businessAccountId}
                    onChange={(event) => { setBusinessAccountId(event.target.value); setPage(1); }}
                    className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
                  >
                    <option value="">All Business Accounts</option>
                    {accounts.map((account) => (
                      <option key={account._id} value={account._id}>{getAccountLabel(account)}</option>
                    ))}
                  </select>
                  <FiArrowDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </label>
            ) : null}

            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
              <div className="relative">
                <select
                  value={status}
                  onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
                >
                  <option value="">All Status</option>
                  {shipmentStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <FiArrowDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setActiveFlow((current) => current === "manifest" ? null : "manifest")}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                activeFlow === "manifest"
                  ? "border-[#0D1282] bg-[#0D1282] text-white"
                  : "border-slate-300 bg-white text-[#0D1282] hover:border-[#0D1282]/40 hover:bg-[#0D1282]/5"
              }`}
            >
              <FiArchive aria-hidden="true" className="h-4 w-4" />
              Create Manifest
            </button>
            {audience === "admin" ? (
              <button
                type="button"
                onClick={() => setActiveFlow((current) => current === "status" ? null : "status")}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                  activeFlow === "status"
                    ? "border-[#0D1282] bg-[#0D1282] text-white"
                    : "border-slate-300 bg-white text-[#0D1282] hover:border-[#0D1282]/40 hover:bg-[#0D1282]/5"
                }`}
              >
                <FiArrowDown aria-hidden="true" className="h-4 w-4" />
                Update Status
              </button>
            ) : null}
            {selectedList.length ? (
              <span className="ml-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                {selectedList.length} selected
              </span>
            ) : null}
          </div>
        </div>
      </section>

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
        <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-[#0D1282]/20 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
  <div className="mb-5 overflow-hidden rounded-2xl border border-[#0D1282]/20 bg-white shadow-sm">
    {statusSelection.length ? (
      <>
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-[#0D1282]/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0D1282]">
              Update {statusSelection.length}{" "}
              {statusSelection.length === 1 ? "shipment" : "shipments"} to a new status.
            </p>

            {selectedList.length > statusSelection.length ? (
              <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                {selectedList.length - statusSelection.length} selected{" "}
                {selectedList.length - statusSelection.length === 1
                  ? "shipment is"
                  : "shipments are"}{" "}
                not eligible (not booked, on hold or cancelled) and will be skipped.
              </p>
            ) : null}
          </div>

          <span className="w-fit shrink-0 rounded-full border border-[#0D1282]/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#0D1282]">
            {statusSelection.length} selected
          </span>
        </div>

        <div className="grid gap-4 px-5 py-5 lg:grid-cols-3 xl:grid-cols-[minmax(200px,1fr)_minmax(240px,1.15fr)_minmax(220px,1fr)_auto] xl:items-end">
          <label className="block min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              New Status
            </span>

            <div className="relative mt-2">
              <select
                value={bulkStatus}
                onChange={(event) =>
                  setBulkStatus(event.target.value as ShipmentOperationalStatus)
                }
                className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
              >
                {shipmentOperationalStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <FiArrowDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
            </div>
          </label>

          <label className="block min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Note{" "}
              <span className="font-normal normal-case text-slate-400">
                (optional)
              </span>
            </span>

            <input
              value={bulkStatusNote}
              onChange={(event) => setBulkStatusNote(event.target.value)}
              placeholder="Shared note for these shipments"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
            />
          </label>

          <label className="block min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Location{" "}
              <span className="font-normal normal-case text-slate-400">
                (optional)
              </span>
            </span>

            <input
              value={bulkStatusLocation}
              onChange={(event) => setBulkStatusLocation(event.target.value)}
              maxLength={120}
              placeholder="Delhi Hub"
              title="Where this scan happened. Shown to the customer as the shipment's current location."
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
            />
          </label>

          <div className="flex gap-2 lg:col-span-3 xl:col-span-1">
            <button
              type="button"
              onClick={handleBulkStatusUpdate}
              disabled={bulkStatusBusy}
              className="h-11 flex-1 whitespace-nowrap rounded-xl bg-[#0D1282] px-5 text-sm font-semibold text-white transition hover:bg-[#0D1282]/90 disabled:cursor-not-allowed disabled:bg-slate-400 xl:flex-none"
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
              className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 xl:flex-none"
            >
              Cancel
            </button>
          </div>
        </div>
      </>
    ) : (
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#0D1282]">
            Select shipments to update
          </p>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Select shipments below using the checkboxes, then update their
            status at once.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setActiveFlow(null);
            setBulkStatusNote("");
            setBulkStatusLocation("");
          }}
          className="h-10 shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    )}
  </div>
) : null}

      {/* Export carries the same filters as the table, built from one helper so
          a downloaded file can never disagree with what is on screen. */}
      <div className="mb-3 flex justify-end">
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
                <tr key={shipment.id} className="border-b border-slate-100 transition hover:bg-slate-50/70 last:border-b-0">
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
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(shipment)}
                          aria-label={`Delete shipment ${shipment.swiftlineTrackingNumber || shipment.id}`}
                          className="inline-flex items-center gap-1 font-semibold text-[#D71313] hover:text-[#b30f0f]"
                        >
                          <FiTrash2 aria-hidden="true" className="h-4 w-4" />Delete
                        </button>
                      ) : null}
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

      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-slate-600">
          Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="h-9 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] transition hover:border-[#0D1282]/40 hover:bg-[#0D1282]/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="h-9 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0D1282] transition hover:border-[#0D1282]/40 hover:bg-[#0D1282]/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
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

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete this shipment?"
          description={
            <>
              <p>
                <span className="font-semibold text-slate-900">
                  {pendingDelete.swiftlineTrackingNumber || "AWB Pending"}
                </span>
                {pendingDelete.consignee ? ` to ${pendingDelete.consignee}` : ""} will be removed from
                the shipment lists for both staff and the customer.
              </p>
              {/* Says plainly what this does not do. The money side is a
                  cancellation, and an operator reaching for Delete to stop a
                  shipment needs to know it is not the same thing. */}
              <p className="mt-3">
                The carrier booking, the tax invoice and its number, and any manifest are kept, and
                the deletion is recorded. This does not cancel the shipment or refund anything.
              </p>
            </>
          }
          confirmLabel="Delete Shipment"
          busy={deleting}
          busyLabel="Deleting..."
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}