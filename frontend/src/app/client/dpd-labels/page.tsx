"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiEdit3,
  FiExternalLink,
  FiFileText,
  FiPrinter,
  FiTrash2,
  FiUploadCloud,
  FiInfo
} from "react-icons/fi";
import { toast } from "react-toastify";
import {
  ClientDashboardLoading,
  ClientShellUser
} from "@/components/client/ClientDashboardShell";
import ShipmentDraftReadyCard from "@/components/shipments/ShipmentDraftReadyCard";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";
import {
  ClientDashboardAccount,
  ClientShipmentListItem,
  createClientManualShipmentDraft,
  downloadClientDpdInvoiceTemplate,
  getClientDashboard,
  getClientShipments,
  processClientDpdInvoiceUpload,
  uploadClientDpdInvoice
} from "@/lib/clientDashboard";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { downloadShipmentInvoicePdf, shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";
import { useDeleteShipmentDraft } from "@/lib/useDeleteShipmentDraft";
import { RiMenuAddLine } from "react-icons/ri";

type ClientDraft = NonNullable<Awaited<ReturnType<typeof uploadClientDpdInvoice>>["shipmentDraft"]>;

async function loadCurrentUser() {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) return null;

  let response = await fetch(apiUrl("/api/v1/auth/me"), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) return null;

    response = await fetch(apiUrl("/api/v1/auth/me"), {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  const data = await response.json();
  return data.success ? data.user as ClientShellUser : null;
}

function getAvailableBranches(account: ClientDashboardAccount) {
  if (account.assignedBranches.length) return account.assignedBranches;
  return account.account.assignedBranch ? [account.account.assignedBranch] : [];
}

function getAccountKey(account: ClientDashboardAccount) {
  return account.account.id || account.account.accountId;
}

export default function ClientDpdLabelsPage() {
  const router = useRouter();
  const [user, setUser] = useState<ClientShellUser | null>(null);
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [shipments, setShipments] = useState<ClientShipmentListItem[]>([]);
  const [shipmentPage, setShipmentPage] = useState(1);
  const [shipmentRefreshKey, setShipmentRefreshKey] = useState(0);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentError, setShipmentError] = useState("");
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState("");
  const [shipmentPagination, setShipmentPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const selectedAccount = useMemo(
    () => accounts.find((item) => getAccountKey(item) === accountId) ?? accounts[0] ?? null,
    [accountId, accounts]
  );
  const branches = useMemo(() => selectedAccount ? getAvailableBranches(selectedAccount) : [], [selectedAccount]);
  const selectedBranch = branches.find((branch) => branch._id === branchId) ?? branches[0] ?? null;
  const rateCardAssigned = Boolean(selectedAccount?.account.rateCard.assigned);
  const canUpload = Boolean(rateCardAssigned && selectedBranch && file && !busy && !creatingManual);
  const canCreateManual = Boolean(rateCardAssigned && selectedBranch && !busy && !creatingManual);
  const totalWeight = draft?.parcelList.reduce((total, parcel) => total + (parcel.weightKg || 0), 0) ?? 0;
  const selectedAccountDocumentId = selectedAccount?.account.id ?? "";
  const selectedBranchId = selectedBranch?._id ?? "";

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
      setLoading(true);
      setError("");

      try {
        const currentUser = await loadCurrentUser();
        if (!currentUser) {
          await logout();
          router.replace("/");
          return;
        }

        if (currentUser.role !== "client") {
          router.replace("/dashboard");
          return;
        }

        const dashboard = await getClientDashboard();
        if (!mounted) return;

        setUser(currentUser);
        setAccounts(dashboard.accounts);

        const firstAccount = dashboard.accounts[0];
        if (firstAccount) {
          const firstBranch = getAvailableBranches(firstAccount)[0];
          setAccountId(getAccountKey(firstAccount));
          setBranchId(firstBranch?._id ?? "");
        }
      } catch (caughtError) {
        if (!mounted) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment workspace.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadPage();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedAccountDocumentId || !selectedBranchId) return;

    let mounted = true;

    getClientShipments({
      businessAccountId: selectedAccountDocumentId,
      branchId: selectedBranchId,
      page: shipmentPage,
      limit: 10
    })
      .then((result) => {
        if (!mounted) return;
        setShipments(result.shipments);
        setShipmentPagination(result.pagination);
        setShipmentError("");
        if (result.pagination.page !== shipmentPage) setShipmentPage(result.pagination.page);
      })
      .catch((caughtError) => {
        if (!mounted) return;
        setShipments([]);
        setShipmentError(caughtError instanceof Error ? caughtError.message : "Unable to load shipments.");
      })
      .finally(() => {
        if (mounted) setShipmentsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedAccountDocumentId, selectedBranchId, shipmentPage, shipmentRefreshKey]);

  function selectFile(nextFile: File | null) {
    if (!nextFile || !rateCardAssigned) return;
    setFile(nextFile);
    setDraft(null);
    setError("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!rateCardAssigned) return;
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleTemplateDownload() {
    setBusy(true);
    setError("");

    try {
      const blob = await downloadClientDpdInvoiceTemplate();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "swiftline-shipment-invoice-template.xlsx";
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download invoice format.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!rateCardAssigned || !file || !selectedBranch) return;

    setBusy(true);
    setError("");
    setDraft(null);

    try {
      const uploadResult = await uploadClientDpdInvoice({ branchId: selectedBranch._id, file });
      if (uploadResult.duplicate && uploadResult.shipmentDraft) {
        if (uploadResult.alreadyBooked || (uploadResult.bookingState && uploadResult.bookingState !== "EDITABLE")) {
          toast.info(uploadResult.message || "Existing shipment opened.");
          router.push(`/client/shipments/${uploadResult.shipmentDraft._id}`);
          return;
        }
        setDraft(uploadResult.shipmentDraft);
        toast.info("Existing editable draft resumed.");
        setShipmentPage(1);
        setShipmentsLoading(true);
        setShipmentRefreshKey((current) => current + 1);
        return;
      }

      const processResult = await processClientDpdInvoiceUpload(uploadResult.invoiceUpload.id);
      if (processResult.shipmentDraft && (processResult.alreadyBooked || processResult.bookingState === "BOOKED")) {
        toast.info(processResult.message || "Existing shipment opened.");
        router.push(`/client/shipments/${processResult.shipmentDraft._id}`);
        return;
      }
      setDraft(processResult.shipmentDraft ?? null);
      toast.success("Invoice processed and shipment draft created.");
      setShipmentPage(1);
      setShipmentsLoading(true);
      setShipmentRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Invoice could not be processed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualDraft() {
    if (!rateCardAssigned || !selectedBranchId) return;

    setCreatingManual(true);
    setError("");

    try {
      const result = await createClientManualShipmentDraft(selectedBranchId);
      toast.success("Blank shipment draft created.");
      router.push(`/client/dpd-labels/${result.shipmentDraft._id}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error
        ? caughtError.message
        : "Unable to start a blank shipment draft. Please try again.");
      setCreatingManual(false);
    }
  }

  async function handleInvoiceDownload(shipment: ClientShipmentListItem) {
    if (!shipment.shipmentInvoice) return;
    setDownloadingInvoiceId(shipment.id);
    setShipmentError("");

    try {
      await downloadShipmentInvoicePdf(
        shipment.id,
        "client",
        shipment.shipmentInvoice.invoiceNumber
      );
    } catch (caughtError) {
      setShipmentError(caughtError instanceof Error ? caughtError.message : "Unable to download shipment invoice.");
    } finally {
      setDownloadingInvoiceId("");
    }
  }

  function handleShipmentPageChange(page: number) {
    setShipmentsLoading(true);
    setShipmentError("");
    setShipmentPage(page);
  }

  const { requestDelete: requestDraftDelete, dialog: deleteDraftDialog } = useDeleteShipmentDraft({
    actor: "client",
    onChanged: () => setShipmentRefreshKey((key) => key + 1)
  });

  if (loading || !user) return <ClientDashboardLoading />;

  return (
      <div className="mx-auto max-w-8xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl  text-[#0D1282]"> <RiMenuAddLine className="inline-block mb-1 mr-1 text-lg" />Create & Manage Shipment  </h1>
            <p className="mt-1 text-sm text-slate-500">create a new shipment manually or upload an invoice to pre-fill details.</p>
          </div>
          <button
            type="button"
            onClick={handleTemplateDownload}
            disabled={busy || creatingManual}
            className="inline-flex h-10 items-center rounded-4xl justify-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <FiDownload aria-hidden="true" className="h-4 w-4" />
            Download Invoice Format 
          </button>
        </div>

        {error ? (
          <div className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        {selectedAccount && !rateCardAssigned ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <FiInfo aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Shipment booking is paused for your account.</p>
              <p className="mt-1">A rate card has not been assigned yet. Please contact Swiftline support.</p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Account Context</h2>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <ReadOnlyDetail label="Business Account" value={selectedAccount?.account.company.companyName} />
              <ReadOnlyDetail label="Sender Branch" value={selectedBranch?.name} />
            </div>
          </section>

          <aside className="space-y-5">
            <section className="border border-slate-200 bg-white p-5 rounded-2xl">
              <div className="flex items-center justify-center gap-2">
  <h2 className="text-center text-sm font-semibold uppercase text-slate-500">
    Invoice Upload
  </h2>

  <div className="group relative">
    <button
      type="button"
      className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:text-[#0D1282]"
    >
      <FiInfo className="h-3.5 w-3.5" />
    </button>

    <div
      className="
        pointer-events-none absolute left-1/2 top-full z-50 mt-3
        w-64 -translate-x-1/2 rounded-xl
        border border-slate-200 bg-white p-4
        text-left opacity-0 shadow-xl
        transition-all duration-200
        group-hover:translate-y-1 group-hover:opacity-100
      "
    >
      <p className="text-sm font-semibold text-slate-900">
        Upload Invoice
      </p>

      <p className="mt-1 text-xs leading-5 text-slate-600">
        Upload a supported Excel invoice to automatically pre-fill shipment
        details, reducing manual entry and speeding up the booking process.
      </p>

      <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white" />
    </div>
  </div>
</div>
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`mt-4 flex min-h-36 rounded-xl flex-col items-center justify-center border border-dashed px-4 py-6 text-center ${rateCardAssigned ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${dragActive ? "border-blue-900 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
              >
                <FiUploadCloud aria-hidden="true" className="h-8 w-8 text-blue-900" />
                <span className="mt-3 text-sm font-semibold text-slate-900">
                  {file ? file.name : "Drop .xlsx invoice here"}
                </span>
                <span className="mt-1 text-xs font-medium text-slate-500">Account and branch are locked to your login.</span>
                <input type="file" accept=".xlsx" onChange={handleFileChange} disabled={!rateCardAssigned} className="hidden" />
              </label>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!canUpload}
                className="mt-4 inline-flex h-10 w-full rounded-xl items-center justify-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
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
                <FiEdit3 aria-hidden="true" className="h-4 w-4" />
                {creatingManual ? "Starting Draft..." : "Create Without Invoice"}
              </button>
            </section>

            {draft ? (
              <ShipmentDraftReadyCard
                title="Draft ready from client account"
                href={`/client/dpd-labels/${draft._id}`}
                consignee={draft.consigneeEnteredAddress.contactName}
                postcode={draft.consigneeEnteredAddress.postcode}
                parcelCount={draft.parcelList.length}
                totalWeightKg={totalWeight}
              />
            ) : null}
          </aside>
        </div>

        <ClientShipmentTable
          shipments={shipments}
          loading={shipmentsLoading}
          error={shipmentError}
          pagination={shipmentPagination}
          downloadingInvoiceId={downloadingInvoiceId}
          onPageChange={handleShipmentPageChange}
          onInvoiceDownload={handleInvoiceDownload}
          onDeleteDraft={requestDraftDelete}
        />

        {deleteDraftDialog}
      </div>
  );
}

function ClientShipmentTable({
  shipments,
  loading,
  error,
  pagination,
  downloadingInvoiceId,
  onPageChange,
  onInvoiceDownload,
  onDeleteDraft
}: {
  shipments: ClientShipmentListItem[];
  loading: boolean;
  error: string;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  downloadingInvoiceId: string;
  onPageChange: (page: number) => void;
  onInvoiceDownload: (shipment: ClientShipmentListItem) => Promise<void>;
  onDeleteDraft: (draft: { id: string; label: string }) => void;
}) {
  const firstItem = pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const lastItem = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <section className="mt-6 border border-slate-200 bg-white rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Your Shipments</h2>
          <p className="mt-1 text-sm text-slate-500">Shipments created for the selected account and branch.</p>
        </div>
        <p className="text-sm font-semibold text-slate-600">{pagination.total} shipments</p>
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">AWB / Shipment No.</th>
              <th className="px-4 py-3">Consignee</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Chargeable Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-medium text-slate-500">Loading shipments...</td>
              </tr>
            ) : shipments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">No shipments have been created for this branch.</td>
              </tr>
            ) : shipments.map((shipment) => {
              const consignee = shipment.destination.companyName || shipment.destination.contactName || "Not Available";
              const destination = shipment.destination.townOrCity || shipment.destination.postcode || "Destination Not Set";
              const origin = shipment.branch.city || shipment.branch.name || shipment.branch.code || "Origin Not Set";
              const hasInvoice = Boolean(shipment.shipmentInvoice);
              const viewHref = hasInvoice
                ? `/client/shipments/${shipment.id}`
                : `/client/dpd-labels/${shipment.id}`;
              // An unbooked draft is still being worked on, so it reads as
              // "continue" rather than "view" and is the only row that can be deleted.
              const isDraft = shipment.canDelete;

              return (
                <tr key={shipment.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-950">{shipment.swiftlineTrackingNumber || "AWB Pending"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {shipment.shipmentInvoice?.invoiceNumber
                        ? `Tax Invoice: ${shipment.shipmentInvoice.invoiceNumber}`
                        : "Tax Invoice Pending"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{formatCapitalized(consignee)}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatCapitalized(shipment.destination.postcode || shipment.destination.countryName || shipment.destination.countryCode) || "Not Available"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{formatCapitalized(origin)} to {formatCapitalized(destination)}</p>
                    {/* <p className="mt-1 text-xs text-slate-500">{formatCapitalized(shipment.branch.name || shipment.branch.code) || "Assigned Branch"}</p> */}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">
                    {shipment.shipmentInvoice
                      ? formatMinorMoney(shipment.shipmentInvoice.chargeableAmountMinor, shipment.shipmentInvoice.currency)
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex bg-white text-xs font-semibold text-slate-700">
                      {formatCapitalized(shipment.statusLabel || shipment.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-500">
                    {formatDashboardDateTime(shipment.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-44 items-center justify-end gap-2">
                      <Link href={viewHref} className="inline-flex text-left items-center gap-1 font-semibold text-blue-900 hover:text-blue-700">
                        {isDraft ? (
                          <><FiEdit3 aria-hidden="true" className="h-4 w-4" />Continue Draft</>
                        ) : (
                          <><FiExternalLink aria-hidden="true" className="h-4 w-4" />View Shipment</>
                        )}
                      </Link>
                      {isDraft ? (
                        <button
                          type="button"
                          title="Delete draft"
                          aria-label="Delete draft"
                          onClick={() => onDeleteDraft({
                            id: shipment.id,
                            label: formatCapitalized(consignee)
                              || "This draft"
                          })}
                          className="inline-flex rounded h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 transition hover:border-red-600 hover:text-red-600"
                        >
                          <FiTrash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      ) : null}
                      {shipment.shipmentInvoice ? (
                        <>
                          <Link href={shipmentInvoicePageUrl(shipment.id, "client")} target="_blank" rel="noreferrer" title="View invoice" aria-label="View invoice" className="inline-flex rounded h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900">
                            <FiFileText aria-hidden="true" className="h-4 w-4" />
                          </Link>
                          {/* <button type="button" title="Download invoice PDF" aria-label="Download invoice PDF" disabled={downloadingInvoiceId === shipment.id} onClick={() => void onInvoiceDownload(shipment)} className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:opacity-50">
                            <FiDownload aria-hidden="true" className="h-4 w-4" />
                          </button>
                          <Link href={shipmentInvoicePageUrl(shipment.id, "client", true)} target="_blank" rel="noreferrer" title="Print invoice" aria-label="Print invoice" className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900">
                            <FiPrinter aria-hidden="true" className="h-4 w-4" />
                          </Link> */}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 text-sm text-slate-600">
          <p>Showing {firstItem}-{lastItem} of {pagination.total} shipments</p>
          <div className="flex items-center gap-2">
            <button type="button" title="Previous page" aria-label="Previous page" disabled={pagination.page === 1 || loading} onClick={() => onPageChange(pagination.page - 1)} className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40">
              <FiChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <span className="min-w-24 text-center font-semibold text-slate-700">Page {pagination.page} of {pagination.totalPages}</span>
            <button type="button" title="Next page" aria-label="Next page" disabled={pagination.page === pagination.totalPages || loading} onClick={() => onPageChange(pagination.page + 1)} className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40">
              <FiChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatCapitalized(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMinorMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(amountMinor / 100);
}

function ReadOnlyDetail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value || "Not available"}</p>
    </div>
  );
}
