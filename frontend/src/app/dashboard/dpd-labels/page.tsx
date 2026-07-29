"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiDownload, FiEdit3, FiExternalLink, FiFileText, FiPrinter, FiUploadCloud } from "react-icons/fi";
import { toast } from "react-toastify";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import ShipmentDraftReadyCard from "@/components/shipments/ShipmentDraftReadyCard";
import { BusinessAccount, listBusinessAccounts } from "@/lib/businessAccounts";
import { Branch, listBranches } from "@/lib/branches";
import {
  InvoiceUpload,
  ShipmentDraft,
  DpdShipmentHistoryItem,
  ShipmentHoldReason,
  ShipmentOperationalStatus,
  createManualShipmentDraft,
  downloadDpdInvoiceTemplate,
  downloadDpdLabel,
  holdDpdShipment,
  listDpdShipments,
  processInvoiceUpload,
  releaseDpdShipment,
  shipmentHoldReasonOptions,
  shipmentOperationalStatusOptions,
  updateDpdShipmentOperationalStatus,
  uploadInvoice
} from "@/lib/dpdLabels";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { downloadShipmentInvoicePdf, shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";
import { useAdminUser } from "@/lib/useAdminUser";

function FieldLabel({ children, required = false }: { children: string; required?: boolean }) {
  return (
    <span className="text-xs font-semibold uppercase text-slate-500">
      {children}
      {required ? <span className="ml-1 text-red-600">*</span> : null}
    </span>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getAccountLabel(account: BusinessAccount) {
  return `${account.accountId} - ${account.company.companyName || account.contact.email}`;
}

function formatCapitalized(value?: string | null) {
  const cleaned = value?.trim();
  if (!cleaned) return "";

  return cleaned.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function getBranchLocation(item: DpdShipmentHistoryItem) {
  return formatCapitalized(item.branch?.city || item.branch?.name || item.branch?.code) || "Origin Not Set";
}

function getRouteLabel(item: DpdShipmentHistoryItem) {
  const origin = getBranchLocation(item);
  const destination = formatCapitalized(item.shipmentDraft?.consigneeTownOrCity || item.shipmentDraft?.deliveryPostcode) || "Destination Not Set";
  return `${origin} to ${destination}`;
}

export default function DpdLabelsPage() {
  const router = useRouter();
  const { user, loading } = useAdminUser();
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [invoiceUpload, setInvoiceUpload] = useState<InvoiceUpload | null>(null);
  const [shipmentDraft, setShipmentDraft] = useState<ShipmentDraft | null>(null);
  const [history, setHistory] = useState<DpdShipmentHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [shipmentAction, setShipmentAction] = useState<{
    mode: "hold" | "release" | "status";
    shipment: DpdShipmentHistoryItem;
  } | null>(null);
  const [holdReason, setHoldReason] = useState<ShipmentHoldReason>("missing_documents");
  const [nextStatus, setNextStatus] = useState<ShipmentOperationalStatus>("PARCEL_COLLECTED");
  const [actionNote, setActionNote] = useState("");

  const canUpload = useMemo(
    () => Boolean(businessAccountId && branchId && file && !busy && !creatingManual),
    [branchId, businessAccountId, busy, creatingManual, file]
  );
  const canCreateManual = Boolean(businessAccountId && branchId && !busy && !creatingManual);
  const draftTotalWeight = shipmentDraft?.parcelList.reduce(
    (total, parcel) => total + (parcel.weightKg || 0),
    0
  ) ?? 0;

  useEffect(() => {
    if (!user) return;

    async function loadOptions() {
      setError("");

      try {
        const [accountData, branchData, shipmentData] = await Promise.all([
          listBusinessAccounts(),
          listBranches("", "ACTIVE"),
          listDpdShipments(10)
        ]);

        setAccounts(accountData.accounts);
        setBranches(branchData.branches);
        setHistory(shipmentData.shipments);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load upload options.");
      }
    }

    void loadOptions();
  }, [user]);

  function selectFile(nextFile: File | null) {
    if (!nextFile) return;
    setInvoiceUpload(null);
    setShipmentDraft(null);
    setError("");
    setFile(nextFile);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleTemplateDownload() {
    setBusy(true);
    setError("");

    try {
      const blob = await downloadDpdInvoiceTemplate();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "swiftline-dpd-invoice-template.xlsx";
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download invoice template.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!file || !businessAccountId || !branchId) return;

    setBusy(true);
    setError("");
    setInvoiceUpload(null);
    setShipmentDraft(null);

    try {
      const uploadResult = await uploadInvoice({ businessAccountId, branchId, file });
      setInvoiceUpload(uploadResult.invoiceUpload);

      if (uploadResult.duplicate && uploadResult.shipmentDraft) {
        if (uploadResult.alreadyBooked || (uploadResult.bookingState && uploadResult.bookingState !== "EDITABLE")) {
          toast.info(uploadResult.message || "Existing shipment opened.");
          router.push(`/dashboard/shipments/${uploadResult.shipmentDraft._id}`);
          return;
        }
        setShipmentDraft(uploadResult.shipmentDraft);
        toast.info("Existing editable draft resumed.");
        const shipmentData = await listDpdShipments(10);
        setHistory(shipmentData.shipments);
        return;
      }

      const processResult = await processInvoiceUpload(uploadResult.invoiceUpload.id);
      if (processResult.shipmentDraft && (processResult.alreadyBooked || processResult.bookingState === "BOOKED")) {
        toast.info(processResult.message || "Existing shipment opened.");
        router.push(`/dashboard/shipments/${processResult.shipmentDraft._id}`);
        return;
      }
      setInvoiceUpload(processResult.invoiceUpload);
      setShipmentDraft(processResult.shipmentDraft);
      toast.success("Invoice processed and shipment draft created.");
      const shipmentData = await listDpdShipments(10);
      setHistory(shipmentData.shipments);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Invoice could not be processed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualDraft() {
    if (!businessAccountId || !branchId) return;

    setCreatingManual(true);
    setError("");

    try {
      const result = await createManualShipmentDraft({ businessAccountId, branchId });
      toast.success("Blank shipment draft created.");
      router.push(`/dashboard/dpd-labels/${result.shipmentDraft._id}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error
        ? caughtError.message
        : "Unable to start a blank shipment draft. Please try again.");
      setCreatingManual(false);
    }
  }

  async function handleLabelDownload(dpdShipmentId: string, labelId: string, parcelNumber?: string) {
    setBusy(true);
    setError("");

    try {
      const blob = await downloadDpdLabel(dpdShipmentId, labelId);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dpd-label-${parcelNumber || dpdShipmentId}.pdf`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download shipment label.");
    } finally {
      setBusy(false);
    }
  }

  async function handleInvoiceDownload(item: DpdShipmentHistoryItem) {
    if (!item.shipmentDraft) return;
    setBusy(true);
    setError("");
    try {
      await downloadShipmentInvoicePdf(
        item.shipmentDraft.id,
        "admin",
        item.shipmentInvoice?.invoiceNumber
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download shipment invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshHistory() {
    const shipmentData = await listDpdShipments(10);
    setHistory(shipmentData.shipments);
  }

  async function handleShipmentAction() {
    if (!shipmentAction) return;
    if (shipmentAction.mode !== "status" && actionNote.trim().length < 3) return;

    setBusy(true);
    setError("");

    try {
      if (shipmentAction.mode === "hold") {
        await holdDpdShipment({
          dpdShipmentId: shipmentAction.shipment.dpdShipment.id,
          reason: holdReason,
          note: actionNote
        });
      } else if (shipmentAction.mode === "release") {
        await releaseDpdShipment({
          dpdShipmentId: shipmentAction.shipment.dpdShipment.id,
          note: actionNote
        });
      } else {
        await updateDpdShipmentOperationalStatus({
          dpdShipmentId: shipmentAction.shipment.dpdShipment.id,
          status: nextStatus,
          note: actionNote || "Live action updated by Swiftline Operations"
        });
      }

      setShipmentAction(null);
      setActionNote("");
      await refreshHistory();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Shipment action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Create Shipment</h1>
          <p className="mt-1 text-sm text-slate-500">Upload an invoice to create a shipment draft.</p>
        </div>
        <button
          type="button"
          onClick={handleTemplateDownload}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-4xl justify-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <FiDownload aria-hidden="true" className="h-4 w-4" />
          Download Invoice Template
        </button>
      </div>

      {error ? (
        <div className="mb-4 border border-red-200 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="border border-slate-200 bg-white rounded-2xl">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Account Context</h2>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <label className="block">
              <FieldLabel required>Business Account</FieldLabel>
              <div className="relative mt-2">
                <select
                  value={businessAccountId}
                  onChange={(event) => setBusinessAccountId(event.target.value)}
                  className="h-10 w-full appearance-none border rounded-xl border-slate-300 bg-white px-3 pr-11 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account.accountId}>
                      {getAccountLabel(account)}
                    </option>
                  ))}
                </select>
                <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </div>
            </label>

            <label className="block">
              <FieldLabel required>Branch</FieldLabel>
              <div className="relative mt-2">
                <select
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  className="h-10 w-full appearance-none border border-slate-300 rounded-xl bg-white px-3 pr-11 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch._id} value={branch.code}>
                      {branch.code} - {branch.name}
                    </option>
                  ))}
                </select>
                <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </div>
            </label>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="border border-slate-200 bg-white p-5 rounded-2xl">
            <h2 className="text-sm font-semibold uppercase text-slate-500 text-center">Invoice Upload</h2>
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mt-4 flex min-h-36 cursor-pointer rounded-xl flex-col items-center justify-center border border-dashed px-4 py-6 text-center transition ${
                dragActive ? "border-blue-900 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-900"
              }`}
            >
              <FiUploadCloud aria-hidden="true" className="h-8 w-8 text-blue-900" />
              <span className="mt-3 text-sm font-semibold text-slate-900">
                {file ? file.name : "Drop .xlsx invoice here"}
              </span>
              <span className="mt-1 text-xs font-medium text-slate-500">
                {file ? formatBytes(file.size) : "or click to choose a file"}
              </span>
              <input type="file" accept=".xlsx" onChange={handleFileChange} className="sr-only" />
            </label>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!canUpload}
              className="mt-4 inline-flex rounded-xl h-10 w-full items-center justify-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <FiFileText aria-hidden="true" className="h-4 w-4" />
              {busy ? "Processing..." : "Create Draft"}
            </button>
            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-semibold uppercase text-slate-400">Or</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <button
              type="button"
              onClick={handleManualDraft}
              disabled={!canCreateManual}
              className="inline-flex h-10 w-full items-center rounded-xl justify-center gap-2 border border-blue-900 bg-white px-4 text-sm font-semibold text-blue-900 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
            >
           
              {creatingManual ? "Starting Draft..." : "Create Without Invoice"}
            </button>
          </section>

          {invoiceUpload?.processingErrors.length ? (
            <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {invoiceUpload.processingErrors[0]}
            </div>
          ) : null}

          {shipmentDraft ? (
            <ShipmentDraftReadyCard
              title="Draft ready from admin account"
              href={`/dashboard/dpd-labels/${shipmentDraft._id}`}
              consignee={shipmentDraft.consigneeEnteredAddress.contactName}
              postcode={shipmentDraft.consigneeEnteredAddress.postcode}
              parcelCount={shipmentDraft.parcelList.length}
              totalWeightKg={draftTotalWeight}
            />
          ) : null}
        </aside>
      </div>

      <section className="mt-6 border border-slate-200 bg-white rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-500">Recent Shipments</h2>
            <p className="mt-1 text-xs text-slate-500">Open existing shipments without creating duplicates.</p>
          </div>
        </div>
        {shipmentAction ? (
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
              {shipmentAction.mode === "hold" ? (
                <label>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hold Reason</span>
                  <select
                    value={holdReason}
                    onChange={(event) => setHoldReason(event.target.value as ShipmentHoldReason)}
                    className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
                  >
                    {shipmentHoldReasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : shipmentAction.mode === "status" ? (
                <label>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Status</span>
                  <select
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as ShipmentOperationalStatus)}
                    className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
                  >
                    {shipmentOperationalStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Release Action</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {shipmentAction.shipment.invoiceUpload?.shipmentReference || shipmentAction.shipment.dpdShipment.dpdShipmentId}
                  </p>
                </div>
              )}
              <label>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {shipmentAction.mode === "hold" ? "Hold Note" : shipmentAction.mode === "release" ? "Release Note" : "Status Note"}
                </span>
                <input
                  value={actionNote}
                  onChange={(event) => setActionNote(event.target.value)}
                  placeholder={
                    shipmentAction.mode === "hold"
                      ? "Explain why this shipment is on hold"
                      : shipmentAction.mode === "release"
                        ? "Explain why this shipment can continue"
                        : "Optional update note"
                  }
                  className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-900 focus:outline-none"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleShipmentAction}
                  disabled={busy || (shipmentAction.mode !== "status" && actionNote.trim().length < 3)}
                  className="h-10 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {busy ? "Saving..." : shipmentAction.mode === "hold" ? "Hold" : shipmentAction.mode === "release" ? "Release" : "Update"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShipmentAction(null);
                    setActionNote("");
                  }}
                  className="h-10 border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
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
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No shipments yet.</td>
                </tr>
              ) : history.map((item) => (
                <tr key={item.dpdShipment.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-950">{item.invoiceUpload?.shipmentReference || item.dpdShipment.dpdShipmentId || "Pending"}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.invoiceUpload?.invoiceNumber || item.dpdShipment.serviceCode}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{item.shipmentDraft?.consigneeName || "Not set"}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.shipmentDraft?.deliveryPostcode || "Not set"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{getRouteLabel(item)}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatCapitalized(item.branch?.name || item.branch?.code) || "Assigned Branch"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">
                    {item.shipmentInvoice
                      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: item.shipmentInvoice.currency, minimumFractionDigits: 2 }).format(item.shipmentInvoice.chargeableAmountMinor / 100)
                      : "-"}
                  </td>
                  <td className="px-4 py-3">{item.currentEvent?.statusLabel || item.dpdShipment.status}</td>
                  <td className="px-4 py-3">{formatDashboardDateTime(item.dpdShipment.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {item.shipmentDraft ? (
                        <>
                          <Link href={`/dashboard/shipments/${item.shipmentDraft.id}`} className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700">
                            <FiExternalLink aria-hidden="true" className="h-4 w-4" />View Details
                          </Link>
                          <Link href={shipmentInvoicePageUrl(item.shipmentDraft.id, "admin")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700">
                            <FiFileText aria-hidden="true" className="h-4 w-4" />Invoice
                          </Link>
                          <button type="button" title="Download invoice PDF" aria-label="Download invoice PDF" disabled={busy} onClick={() => void handleInvoiceDownload(item)} className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:opacity-50">
                            <FiDownload aria-hidden="true" className="h-4 w-4" />
                          </button>
                          <Link href={shipmentInvoicePageUrl(item.shipmentDraft.id, "admin", true)} target="_blank" rel="noreferrer" title="Print invoice" aria-label="Print invoice" className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900">
                            <FiPrinter aria-hidden="true" className="h-4 w-4" />
                          </Link>
                        </>
                      ) : null}
                      {item.currentEvent?.status === "ON_HOLD" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShipmentAction({ mode: "release", shipment: item });
                            setActionNote("");
                          }}
                          className="font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          Release
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShipmentAction({ mode: "status", shipment: item });
                              setActionNote("");
                            }}
                            className="font-semibold text-blue-900 hover:text-blue-700"
                          >
                            Update Status
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShipmentAction({ mode: "hold", shipment: item });
                              setActionNote("");
                            }}
                            className="font-semibold text-amber-700 hover:text-amber-800"
                          >
                            Hold
                          </button>
                        </>
                      )}
                      {item.labels.length ? (
                        <button
                          type="button"
                          onClick={() => {
                            const label = item.labels.find((candidate) => candidate.labelType === "DPD") ?? item.labels[0];
                            if (label) void handleLabelDownload(item.dpdShipment.id, label.id, label.parcelNumber);
                          }}
                          className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          <FiDownload aria-hidden="true" className="h-4 w-4" />
                          Label
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  );
}
