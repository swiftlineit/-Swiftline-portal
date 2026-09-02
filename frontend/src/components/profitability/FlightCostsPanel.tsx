"use client";

import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiCheck, FiEdit3, FiPlus, FiRefreshCw, FiTrash2, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatCreditMoney } from "@/lib/creditAccounts";
import {
  cancelFlightCostSheet,
  createFlightCostSheet,
  deleteDraftFlightCostSheet,
  finalizeFlightCostSheet,
  getFlightCostSheet,
  getFlightManifestPreview,
  getGbpToInrRate,
  isBilledWeightOverride,
  isFlightRateEligible,
  listFlightBuyingRates,
  listFlightCostSheets,
  listFlightManifestOptions,
  listProfitabilityVendors,
  updateFlightCostSheet,
  type FlightBuyingRate,
  type FlightCostSheet,
  type FlightCostTotals,
  type FlightManifestOption,
  type FlightManifestPreview,
  type LogisticsVendor,
} from "@/lib/profitability";
import ProfitabilitySelect from "./ProfitabilitySelect";

const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10 disabled:bg-slate-100 disabled:text-slate-500";
type Preview = FlightManifestPreview;
type Draft = {
  manifestId: string;
  rateId: string;
  airlineName: string;
  billedWeight: string;
  billedWeightReason: string;
  externalLabels: string;
  externalReference: string;
  fxRate: string;
  fxProvider: string;
  fxUpdatedAt: string | null;
  fxFetchedAt: string;
  manualFx: boolean;
  notes: string;
};
const emptyDraft = (): Draft => ({
  manifestId: "",
  rateId: "",
  airlineName: "",
  billedWeight: "",
  billedWeightReason: "",
  externalLabels: "0",
  externalReference: "",
  fxRate: "",
  fxProvider: "ExchangeRate-API",
  fxUpdatedAt: null,
  fxFetchedAt: new Date().toISOString(),
  manualFx: false,
  notes: "",
});

function calculatePreview(
  rate: Pick<FlightBuyingRate, "airFreightRateMinorPerKg" | "gstBasisPoints" | "eicfRateMinorPerKg" | "customsMinor" | "transportationMinor" | "cflMinorPerBagGbp" | "dpdLabelMinorGbp"> | undefined,
  facts: { billedWeightKg: number; totalBags: number; portalDpdLabels: number; externalPaidLabels: number },
  gbpToInr: number,
  revenueMinor = 0
): FlightCostTotals | null {
  if (!rate || !Number.isFinite(gbpToInr) || gbpToInr <= 0) return null;
  const airFreightBaseMinor = Math.round(rate.airFreightRateMinorPerKg * facts.billedWeightKg);
  const airFreightGstMinor = Math.round((airFreightBaseMinor * rate.gstBasisPoints) / 10_000);
  const eicfMinor = Math.round(rate.eicfRateMinorPerKg * facts.billedWeightKg);
  const cflGbpMinor = rate.cflMinorPerBagGbp * facts.totalBags;
  const cflInrMinor = Math.round(cflGbpMinor * gbpToInr);
  const dpdLabelsGbpMinor = rate.dpdLabelMinorGbp * (facts.portalDpdLabels + facts.externalPaidLabels);
  const dpdLabelsInrMinor = Math.round(dpdLabelsGbpMinor * gbpToInr);
  const totalCostMinor =
    airFreightBaseMinor + airFreightGstMinor + eicfMinor + rate.customsMinor + rate.transportationMinor + cflInrMinor + dpdLabelsInrMinor;
  const grossProfitMinor = revenueMinor - totalCostMinor;
  return {
    airFreightBaseMinor,
    airFreightGstMinor,
    airFreightTotalMinor: airFreightBaseMinor + airFreightGstMinor,
    eicfMinor,
    customsMinor: rate.customsMinor,
    transportationMinor: rate.transportationMinor,
    cflGbpMinor,
    cflInrMinor,
    dpdLabelsGbpMinor,
    dpdLabelsInrMinor,
    totalCostMinor,
    totalRevenueMinor: revenueMinor,
    grossProfitMinor,
    marginBasisPoints: revenueMinor > 0 ? Math.round((grossProfitMinor / revenueMinor) * 10_000) : null,
  };
}

export default function FlightCostsPanel({ branchId, canDeleteDrafts }: { branchId: string; canDeleteDrafts: boolean }) {
  const [sheets, setSheets] = useState<FlightCostSheet[]>([]);
  const [manifests, setManifests] = useState<FlightManifestOption[]>([]);
  const [rates, setRates] = useState<FlightBuyingRate[]>([]);
  const [vendors, setVendors] = useState<LogisticsVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editor, setEditor] = useState(false);
  const [sheet, setSheet] = useState<FlightCostSheet | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [statusFilter, setStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [cancelDialog, setCancelDialog] = useState(false);

  async function load() {
    const [sheetResult, manifestResult, rateResult, vendorResult] = await Promise.all([
      listFlightCostSheets({ branchId, status: statusFilter, vendorId: vendorFilter, from: fromFilter, to: toFilter }),
      listFlightManifestOptions(branchId),
      listFlightBuyingRates(),
      listProfitabilityVendors(),
    ]);
    setSheets(sheetResult.sheets);
    setManifests(manifestResult.manifests);
    setRates(rateResult.rates);
    setVendors(vendorResult.vendors.filter((v) => v.status === "ACTIVE"));
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      listFlightCostSheets({ branchId, status: statusFilter, vendorId: vendorFilter, from: fromFilter, to: toFilter }),
      listFlightManifestOptions(branchId),
      listFlightBuyingRates(),
      listProfitabilityVendors(),
    ])
      .then(([sheetResult, manifestResult, rateResult, vendorResult]) => {
        if (!active) return;
        setSheets(sheetResult.sheets);
        setManifests(manifestResult.manifests);
        setRates(rateResult.rates);
        setVendors(vendorResult.vendors.filter((v) => v.status === "ACTIVE"));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Flight costs could not be loaded."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branchId, statusFilter, vendorFilter, fromFilter, toFilter]);

  const selectedRate = rates.find((item) => item.id === draft.rateId);
  const calculationRate = sheet && draft.rateId === sheet.buyingRateId ? sheet.rateSnapshot : selectedRate;
  const eligibleRates = rates.filter((item) => {
    if (sheet && item.id === sheet.buyingRateId) return true;
    if (!preview) return false;
    return isFlightRateEligible(item, preview.header.destinationCountryCode, preview.header.departureDate);
  });
  const manifestWeight = preview?.manifestWeightKg ?? sheet?.manifestWeightKg ?? 0;
  const billedWeight = Number(draft.billedWeight || manifestWeight || 0);
  const externalLabels = Math.max(0, Number(draft.externalLabels) || 0);
  const fxRate = Number(draft.fxRate);
  const totals =
    sheet && sheet.id
      ? calculatePreview(
          calculationRate,
          {
            billedWeightKg: billedWeight,
            totalBags: preview?.totalBags ?? sheet.totalBags,
            portalDpdLabels: preview?.portalDpdLabels ?? sheet.portalDpdLabels,
            externalPaidLabels: externalLabels,
          },
          fxRate,
          sheet.totals.totalRevenueMinor
        )
      : calculatePreview(
          calculationRate,
          {
            billedWeightKg: billedWeight,
            totalBags: preview?.totalBags ?? 0,
            portalDpdLabels: preview?.portalDpdLabels ?? 0,
            externalPaidLabels: externalLabels,
          },
          fxRate
        );

  async function refreshFx() {
    try {
      const result = await getGbpToInrRate();
      setDraft((current) => ({
        ...current,
        fxRate: String(result.rate.gbpToInr),
        fxProvider: result.rate.provider,
        fxUpdatedAt: result.rate.providerUpdatedAt,
        fxFetchedAt: result.rate.fetchedAt,
        manualFx: false,
      }));
      toast.success("GBP/INR rate refreshed.");
    } catch (error) {
      setDraft((current) => ({ ...current, manualFx: true, fxProvider: "Manual" }));
      toast.error(error instanceof Error ? error.message : "Exchange rate could not be refreshed.");
    }
  }

  async function openNew() {
    setSheet(null);
    setPreview(null);
    setDraft(emptyDraft());
    setEditor(true);
    await refreshFx();
  }

  async function selectManifest(id: string) {
    setDraft((current) => ({ ...current, manifestId: id, rateId: "" }));
    if (!id) return setPreview(null);
    const existing = manifests.find((item) => item.id === id)?.costSheet;
    if (existing) return openExisting(existing.id);
    try {
      const result = await getFlightManifestPreview(id);
      setPreview(result.manifest);
      setDraft((current) => ({ ...current, manifestId: id, billedWeight: String(result.manifest.manifestWeightKg), billedWeightReason: "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Manifest facts could not be loaded.");
    }
  }

  async function openExisting(id: string) {
    try {
      const result = await getFlightCostSheet(id);
      const item = result.sheet;
      setSheet(item);
      const manifestResult = await getFlightManifestPreview(item.operationsManifestId);
      setPreview(manifestResult.manifest);
      setDraft({
        manifestId: item.operationsManifestId,
        rateId: item.buyingRateId,
        airlineName: item.airlineName,
        billedWeight: String(item.billedWeightKg),
        billedWeightReason: item.billedWeightOverrideReason,
        externalLabels: String(item.externalPaidLabels),
        externalReference: item.externalLabelReference,
        fxRate: String(item.fxSnapshot.gbpToInr),
        fxProvider: item.fxSnapshot.provider,
        fxUpdatedAt: item.fxSnapshot.providerUpdatedAt,
        fxFetchedAt: item.fxSnapshot.fetchedAt,
        manualFx: item.fxSnapshot.isManual,
        notes: item.notes,
      });
      setEditor(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Flight cost sheet could not be opened.");
    }
  }

  function payload() {
    const override = isBilledWeightOverride(billedWeight, manifestWeight);
    return {
      buyingRateId: draft.rateId,
      airlineName: draft.airlineName.trim(),
      ...(override ? { billedWeightKg: billedWeight } : {}),
      billedWeightOverrideReason: override ? draft.billedWeightReason.trim() : "",
      externalPaidLabels: externalLabels,
      externalLabelReference: draft.externalReference.trim(),
      fxSnapshot: {
        gbpToInr: fxRate,
        provider: draft.manualFx ? "Manual" : draft.fxProvider,
        providerUpdatedAt: draft.fxUpdatedAt,
        fetchedAt: draft.fxFetchedAt,
        isManual: draft.manualFx,
        manualReason: "",
      },
      notes: draft.notes.trim(),
    };
  }

  async function save() {
    if (!draft.manifestId || !draft.rateId || draft.airlineName.trim().length < 2)
      return toast.error("Select a manifest and rate, then enter the airline.");
    if (!Number.isFinite(fxRate) || fxRate <= 0) return toast.error("Enter a valid GBP/INR rate.");
    if (isBilledWeightOverride(billedWeight, manifestWeight) && draft.billedWeightReason.trim().length < 3)
      return toast.error("Enter a reason for the billed weight override.");
    if (externalLabels > 0 && draft.externalReference.trim().length < 2)
      return toast.error("Enter the external-label reference.");
    setSaving(true);
    try {
      const result = sheet
        ? await updateFlightCostSheet(sheet.id, { ...payload(), expectedVersion: sheet.version })
        : await createFlightCostSheet({ ...payload(), operationsManifestId: draft.manifestId });
      toast.success(result.message);
      await load();
      await openExisting(result.sheet.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Flight costs could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (!sheet) return;
    setSaving(true);
    try {
      const result = await finalizeFlightCostSheet(sheet.id, sheet.version);
      toast.success(result.message);
      await load();
      await openExisting(result.sheet.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Flight costs could not be finalized.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft(item: FlightCostSheet) {
    if (item.status !== "DRAFT") return;
    const confirmed = window.confirm(
      `Delete draft ${item.manifestNumber}? This removes the provisional cost allocations and restores the shipment profitability values. Only draft sheets can be deleted; finalized, review-required, and cancelled records are retained for audit.`
    );
    if (!confirmed) return;

    setDeletingId(item.id);
    try {
      const result = await deleteDraftFlightCostSheet(item.id);
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The draft flight cost sheet could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  async function cancelSheet(reason: string) {
    if (!sheet) return;
    setSaving(true);
    try {
      const result = await cancelFlightCostSheet(sheet.id, sheet.version, reason);
      toast.success(result.message);
      await load();
      setEditor(false);
      setSheet(null);
      setCancelDialog(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sheet could not be cancelled.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  if (!editor) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-950">Flight costs</h2>
            <p className="mt-1 text-sm text-slate-600">One cost sheet per flight. Choose a manifest already attached to that flight.</p>
          </div>
          <button
            onClick={() => void openNew()}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0A0E68]"
          >
            <FiPlus /> New cost sheet
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
          <label className="block min-w-36 text-xs font-semibold text-slate-600">
            Status
            <ProfitabilitySelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 min-w-36">
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="FINALIZED">Finalized</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="PROVISIONAL">Provisional</option>
              <option value="ACTUAL">Actual</option>
            </ProfitabilitySelect>
          </label>
          <label className="block min-w-40 text-xs font-semibold text-slate-600">
            Vendor
            <ProfitabilitySelect value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="mt-1 min-w-36">
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.name}
                </option>
              ))}
            </ProfitabilitySelect>
          </label>
          <label className="block min-w-36 text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="mt-1 block h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
          </label>
          <label className="block min-w-36 text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="mt-1 block h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-left text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Manifest</th>
                <th className="px-4 py-3">Flight</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3 text-right">Total cost</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3 text-right">Margin</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-slate-500">
                    Loading flight costs…
                  </td>
                </tr>
              ) : sheets.length ? (
                sheets.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#0D1282]">{item.manifestNumber}</p>
                      <p className="text-xs text-slate-500">{item.mawbNumber}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{item.airlineName}</p>
                      <p className="text-xs text-slate-500">
                        {item.flightNumber} · {item.flightDate}
                      </p>
                    </td>
                    <td className="px-4 py-3">{item.vendor.name ?? "-"}</td>
                    <td className="px-4 py-3">{item.destinationCountryName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.billedWeightKg.toFixed(3)} kg</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatCreditMoney(item.totals.totalCostMinor, "INR")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCreditMoney(item.totals.totalRevenueMinor, "INR")}</td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${item.totals.grossProfitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {formatCreditMoney(item.totals.grossProfitMinor, "INR")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.totals.marginBasisPoints == null ? "-" : `${(item.totals.marginBasisPoints / 100).toFixed(2)}%`}
                    </td>
                    <td className="px-4 py-3">
                      <Status value={item.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => void openExisting(item.id)}
                          className="inline-flex h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-[#0D1282] hover:bg-slate-50"
                        >
                          <FiEdit3 /> Open
                        </button>
                        {canDeleteDrafts && item.status === "DRAFT" ? (
                          <button
                            type="button"
                            onClick={() => void deleteDraft(item)}
                            disabled={deletingId === item.id}
                            aria-label={`Delete draft cost sheet ${item.manifestNumber}`}
                            title="Delete draft cost sheet"
                            className="inline-flex h-11 items-center gap-1 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                          >
                            <FiTrash2 /> {deletingId === item.id ? "Deleting…" : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-slate-500">
                    No flight costs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  const facts = {
    manifestWeightKg: preview?.manifestWeightKg ?? sheet?.manifestWeightKg ?? 0,
    totalBags: preview?.totalBags ?? sheet?.totalBags ?? 0,
    totalParcels: preview?.totalParcels ?? sheet?.totalParcels ?? 0,
    portalLabels: preview?.portalDpdLabels ?? sheet?.portalDpdLabels ?? 0,
    billableLabels: (preview?.portalDpdLabels ?? sheet?.portalDpdLabels ?? 0) + externalLabels,
    missingLabels: Math.max(
      0,
      (preview?.totalParcels ?? sheet?.totalParcels ?? 0) - (preview?.portalDpdLabels ?? sheet?.portalDpdLabels ?? 0) - externalLabels
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => setEditor(false)}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-white"
        >
          <FiArrowLeft /> Flight costs
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || sheet?.status === "CANCELLED"}
            className="h-11 rounded-lg border border-[#0D1282] px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-50"
          >
            {saving ? "Saving…" : sheet?.status === "FINALIZED" ? "Amend" : "Save draft"}
          </button>
          {sheet?.status !== "FINALIZED" && sheet?.status !== "CANCELLED" ? (
            <button
              onClick={() => void finalize()}
              disabled={!sheet || saving}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0D1282] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <FiCheck /> Finalize cost sheet
            </button>
          ) : null}
          {sheet && sheet.status !== "CANCELLED" && sheet.status !== "FINALIZED" ? (
            <button
              onClick={() => setCancelDialog(true)}
              disabled={!sheet || saving}
              className="h-11 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel sheet
            </button>
          ) : null}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-7">
          {(
            [
              ["Operations Manifest", preview?.manifestNumber ?? sheet?.manifestNumber ?? "Select below"],
              ["MAWB", preview?.header.mawbNumber ?? sheet?.mawbNumber ?? "-"],
              ["Airline", draft.airlineName || "-"],
              ["Flight", preview?.header.flightNumber ?? sheet?.flightNumber ?? "-"],
              ["Date", preview?.header.departureDate ?? sheet?.flightDate ?? "-"],
              ["Destination", preview?.header.destinationCountryName ?? sheet?.destinationCountryName ?? "-"],
              ["Status", preview?.status ?? sheet?.status ?? "DRAFT"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-white px-4 py-3">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={value}>
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ["Manifest weight", `${facts.manifestWeightKg.toFixed(3)} kg`],
              ["Total bags", String(facts.totalBags)],
              ["Total parcels", String(facts.totalParcels)],
              ["Portal DPD labels", String(facts.portalLabels)],
              ["Billable labels", String(facts.billableLabels)],
              ["Missing DPD labels", String(facts.missingLabels)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p
                className={`mt-1 text-lg font-bold tabular-nums ${label === "Missing DPD labels" && facts.missingLabels ? "text-red-700" : "text-slate-950"}`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-950">Flight details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm font-semibold text-slate-700">
                Operations Manifest
                <ProfitabilitySelect
                  value={draft.manifestId}
                  disabled={Boolean(sheet)}
                  onChange={(event) => void selectManifest(event.target.value)}
                  className="mt-2"
                >
                  <option value="">Select manifest</option>
                  {manifests.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.manifestNumber} · {item.header.destinationCountryName || "Destination pending"}
                    </option>
                  ))}
                </ProfitabilitySelect>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Buying rate
                <ProfitabilitySelect
                  value={draft.rateId}
                  onChange={(event) => setDraft({ ...draft, rateId: event.target.value })}
                  disabled={!preview || sheet?.status === "CANCELLED"}
                  className="mt-2"
                >
                  <option value="">{preview ? "Select rate" : "Select manifest first"}</option>
                  {eligibleRates.map((item) => {
                    const usesSavedSnapshot = Boolean(sheet && item.id === sheet.buyingRateId);
                    const airFreightRate = usesSavedSnapshot ? sheet!.rateSnapshot.airFreightRateMinorPerKg : item.airFreightRateMinorPerKg;
                    return (
                      <option key={item.id} value={item.id}>
                        {item.vendor.name} · {item.region} · ₹{(airFreightRate / 100).toFixed(2)}/kg{usesSavedSnapshot ? " · saved snapshot" : ""}
                      </option>
                    );
                  })}
                </ProfitabilitySelect>
                {preview && !eligibleRates.length ? <span className="mt-2 block text-xs font-medium text-amber-700">No active rate matches this destination and flight date.</span> : null}
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Airline name
                <input value={draft.airlineName} onChange={(event) => setDraft({ ...draft, airlineName: event.target.value })} className={inputClass} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Billed weight
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={draft.billedWeight}
                  onChange={(event) => setDraft({ ...draft, billedWeight: event.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
            {isBilledWeightOverride(billedWeight, facts.manifestWeightKg) ? (
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Billed weight override reason
                <input
                  value={draft.billedWeightReason}
                  onChange={(event) => setDraft({ ...draft, billedWeightReason: event.target.value })}
                  className={inputClass}
                />
              </label>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <SectionTitle title="Air freight" />
            <CostLine
              label="Air freight"
              basis="Per kg"
              quantity={`${billedWeight.toFixed(3)} kg`}
              rate={calculationRate ? formatCreditMoney(calculationRate.airFreightRateMinorPerKg, "INR") : "-"}
              amount={totals?.airFreightBaseMinor}
            />
            <CostLine
              label="GST on air freight"
              basis="On base"
              quantity={calculationRate ? `${(calculationRate.gstBasisPoints / 100).toFixed(2)}%` : "-"}
              rate=""
              amount={totals?.airFreightGstMinor}
            />
            <CostLine
              label="EICF"
              basis="Per kg"
              quantity={`${billedWeight.toFixed(3)} kg`}
              rate={calculationRate ? formatCreditMoney(calculationRate.eicfRateMinorPerKg, "INR") : "-"}
              amount={totals?.eicfMinor}
            />
            <SectionTitle title="India charges" />
            <CostLine label="Customs" basis="Per flight" quantity="1" rate="" amount={totals?.customsMinor} />
            <CostLine label="Transportation" basis="Per flight" quantity="1" rate="" amount={totals?.transportationMinor} />
            <SectionTitle title="Destination charges" />
            <CostLine
              label="CFL"
              basis="Per bag"
              quantity={`${facts.totalBags} bags`}
              rate={calculationRate ? `£${(calculationRate.cflMinorPerBagGbp / 100).toFixed(2)}` : "-"}
              amount={totals?.cflInrMinor}
              foreignAmount={totals?.cflGbpMinor}
            />
            <CostLine
              label="DPD labels"
              basis="Per label"
              quantity={`${facts.billableLabels} labels`}
              rate={calculationRate ? `£${(calculationRate.dpdLabelMinorGbp / 100).toFixed(2)}` : "-"}
              amount={totals?.dpdLabelsInrMinor}
              foreignAmount={totals?.dpdLabelsGbpMinor}
            />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-950">Label reconciliation</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                External paid labels
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.externalLabels}
                  onChange={(event) => setDraft({ ...draft, externalLabels: event.target.value })}
                  className={inputClass}
                />
              </label>
              {externalLabels > 0 ? <label className="text-sm font-semibold text-slate-700">
                Payment reference
                <input
                  value={draft.externalReference}
                  onChange={(event) => setDraft({ ...draft, externalReference: event.target.value })}
                  className={inputClass}
                />
              </label> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <label className="text-sm font-semibold text-slate-700">
              Notes <span className="font-normal text-slate-500">(optional)</span>
              <input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className={inputClass} />
            </label>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-bold text-slate-950">Amount summary</h2>
              <p className="mt-1 text-sm text-slate-600">All amounts in INR unless shown otherwise.</p>
            </div>
            <div className="space-y-2 px-5 py-4">
              <SummaryRow label="Air freight" value={totals?.airFreightBaseMinor} />
              <SummaryRow label="GST" value={totals?.airFreightGstMinor} />
              <SummaryRow label="EICF" value={totals?.eicfMinor} />
              <SummaryRow label="Customs" value={totals?.customsMinor} />
              <SummaryRow label="Transportation" value={totals?.transportationMinor} />
              <SummaryRow label="CFL" value={totals?.cflInrMinor} foreignValue={totals?.cflGbpMinor} />
              <SummaryRow label="DPD labels" value={totals?.dpdLabelsInrMinor} foreignValue={totals?.dpdLabelsGbpMinor} />
              <div className="my-3 border-t border-slate-200" />
              <SummaryRow label="Total cost" value={totals?.totalCostMinor} strong />
              <SummaryRow label="Flight revenue" value={totals?.totalRevenueMinor} />
              <SummaryRow label="Gross profit" value={totals?.grossProfitMinor} profit />
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-semibold text-slate-700">Margin</span>
                <span className={`text-lg font-bold tabular-nums ${(totals?.marginBasisPoints ?? 0) < 0 ? "text-red-700" : "text-slate-950"}`}>
                  {totals?.marginBasisPoints == null ? "-" : `${(totals.marginBasisPoints / 100).toFixed(2)}%`}
                </span>
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-950">GBP/INR reference</h2>
                <p className="mt-1 text-xs text-slate-500">Stored with this cost sheet.</p>
              </div>
              <button
                onClick={() => void refreshFx()}
                className="grid h-11 w-11 place-items-center rounded-lg text-[#0D1282] hover:bg-blue-50"
                aria-label="Refresh exchange rate"
              >
                <FiRefreshCw />
              </button>
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              GBP to INR
              <input
                type="number"
                min="0.000001"
                step="0.000001"
                value={draft.fxRate}
                onChange={(event) => setDraft({ ...draft, fxRate: event.target.value, manualFx: true, fxProvider: "Manual" })}
                className={inputClass}
              />
            </label>
            <p className="mt-3 text-xs text-slate-500">
              {draft.manualFx ? "Manual rate" : draft.fxProvider}
              {!draft.manualFx && draft.fxUpdatedAt ? ` · updated ${new Date(draft.fxUpdatedAt).toLocaleString("en-IN")}` : ""}
            </p>
          </section>
        </aside>
      </div>
      {cancelDialog && sheet ? <ReasonDialog title="Cancel flight cost sheet?" actionLabel="Cancel sheet" busy={saving} onClose={() => setCancelDialog(false)} onConfirm={cancelSheet} /> : null}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="border-y border-slate-200 bg-slate-50 px-5 py-3 first:border-t-0">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
    </div>
  );
}
function CostLine({
  label,
  basis,
  quantity,
  rate,
  amount,
  foreignAmount,
}: {
  label: string;
  basis: string;
  quantity: string;
  rate: string;
  amount?: number;
  foreignAmount?: number;
}) {
  return (
    <div className="grid items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm sm:grid-cols-[1.3fr_.8fr_.8fr_.8fr_1fr]">
      <span className="font-semibold text-slate-900">{label}</span>
      <span className="text-slate-600">{basis}</span>
      <span className="tabular-nums text-slate-600">{quantity}</span>
      <span className="tabular-nums text-slate-600">{rate}</span>
      <span className="text-right font-semibold tabular-nums text-slate-900">
        {amount === undefined ? "-" : formatCreditMoney(amount, "INR")}
        {foreignAmount !== undefined ? <small className="block font-normal text-slate-500">£{(foreignAmount / 100).toFixed(2)}</small> : null}
      </span>
    </div>
  );
}
function SummaryRow({ label, value, foreignValue, strong = false, profit = false }: { label: string; value?: number; foreignValue?: number; strong?: boolean; profit?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 text-sm ${strong ? "font-bold text-slate-950" : "text-slate-700"}`}>
      <span>{label}</span>
      <span
        className={`tabular-nums ${profit && (value ?? 0) < 0 ? "font-bold text-red-700" : profit ? "font-bold text-emerald-700" : strong ? "text-base" : "font-medium"}`}
      >
        {value === undefined ? "-" : formatCreditMoney(value, "INR")}
        {foreignValue !== undefined ? <small className="block font-normal text-slate-500">£{(foreignValue / 100).toFixed(2)}</small> : null}
      </span>
    </div>
  );
}

function ReasonDialog({ title, actionLabel, busy, onClose, onConfirm }: { title: string; actionLabel: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [busy, onClose]);

  async function submit() {
    if (reason.trim().length < 3) return toast.error("Enter a cancellation reason.");
    try { await onConfirm(reason.trim()); } catch { /* the action already reports its error */ }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div ref={dialogRef} className="w-full max-w-md rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">{title}</h2><button ref={closeRef} onClick={onClose} disabled={busy} className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close"><FiX /></button></div>
      <div className="p-5"><label className="text-sm font-semibold text-slate-700">Cancellation reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10" /></label></div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button onClick={onClose} disabled={busy} className="h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Keep sheet</button><button onClick={() => void submit()} disabled={busy} className="h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Cancelling…" : actionLabel}</button></div>
    </div>
  </div>;
}

function Status({ value }: { value: FlightCostSheet["status"] }) {
  const style =
    value === "FINALIZED"
      ? "bg-emerald-50 text-emerald-700"
      : value === "REVIEW_REQUIRED"
        ? "bg-amber-50 text-amber-700"
        : value === "CANCELLED"
          ? "bg-red-50 text-red-700"
          : "bg-blue-50 text-[#0D1282]";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{value.replaceAll("_", " ")}</span>;
}
