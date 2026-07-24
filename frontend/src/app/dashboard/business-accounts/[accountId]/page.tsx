"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowLeft, FiChevronDown, FiEdit2, FiFile, FiFileText } from "react-icons/fi";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { BusinessAccountAccessPanel } from "@/components/business-accounts/BusinessAccountAccessPanel";
import {
  canadaRegistrationTypeOptions,
  registrationConfig
} from "@/components/business-accounts/FormFieldControls";
import {
  BusinessAccount,
  BusinessKycCheckKey,
  BusinessKycCheckStatus,
  BusinessKycOverallStatus,
  DocumentType,
  getBusinessAccount,
  getBusinessAccountDocument,
  updateBusinessAccountKycReview
} from "@/lib/businessAccounts";
import { useAdminUser } from "@/lib/useAdminUser";
import { useDialog } from "@/lib/useDialog";

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatShipmentType(value: string) {
  if (value === "international_cargo") return "International Cargo";
  if (value === "international_courier") return "International Courier";
  return value.replaceAll("_", " ");
}

function formatOperatingCountries(account: BusinessAccount) {
  return (account.company.operatingCountries ?? (account.company.operatingCountry ? [account.company.operatingCountry] : [])).join(", ");
}

function getRegistrationIdLabel(account: BusinessAccount) {
  if (account.company.registrationCountry === "Canada") {
    return canadaRegistrationTypeOptions.find((option) => option.value === account.company.registrationIdType)?.label ?? "Registration ID";
  }

  return registrationConfig[account.company.registrationCountry]?.primaryLabel ?? "Registration ID";
}

function getAccountStatusBadgeClasses(status: string) {
  switch (status) {
    case "active":
      return "bg-[#0D1282] text-white";
    case "approved":
      return "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50";
    case "rejected":
    case "suspended":
      return "bg-[#D71313]/10 text-[#D71313] ring-1 ring-[#D71313]/20";
    default:
      return "bg-[#0D1282]/10 text-[#0D1282] ring-1 ring-[#0D1282]/20";
  }
}

const documentSummaryRows: { key: DocumentType; label: string; required?: boolean }[] = [
  { key: "aadhaarCard", label: "Aadhaar Card", required: true },
  { key: "panCard", label: "PAN Card Copy", required: true },
  { key: "adCertificate", label: "AD Certificate" },
  { key: "msmeCertificate", label: "MSME Certificate" },
  { key: "tanCertificate", label: "TAN Certificate" },
  { key: "gstCertificate", label: "GST Certificate" },
  { key: "iecCertificate", label: "IEC Certificate" },
  { key: "otherCertificate", label: "Other Certificate" }
];

const kycCheckStatusOptions: { value: BusinessKycCheckStatus; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "under_review", label: "Under Review" },
  { value: "verified", label: "Verified" },
  { value: "information_required", label: "Information Required" },
  { value: "reject", label: "Reject" }
];

const kycStatusStyles: Record<BusinessKycOverallStatus, string> = {
  documents_pending: "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50",
  submitted: "bg-[#0D1282]/8 text-[#0D1282] ring-1 ring-[#0D1282]/20",
  under_review: "bg-[#0D1282]/15 text-[#0D1282] ring-1 ring-[#0D1282]/25",
  additional_information_required: "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50",
  verified: "bg-[#0D1282] text-white",
  rejected: "bg-[#D71313]/10 text-[#D71313] ring-1 ring-[#D71313]/20"
};

function normalizeKycCheckStatus(status?: string): BusinessKycCheckStatus {
  if (status === "failed") return "reject";
  if (status === "replacement_required" || status === "mismatched" || status === "unclear") return "information_required";
  if (kycCheckStatusOptions.some((option) => option.value === status)) return status as BusinessKycCheckStatus;
  return "not_started";
}

type DetailTab = "overview" | "documents" | "kyc" | "access";

export default function BusinessAccountDetailsPage() {
  const params = useParams<{ accountId: string }>();
  const { user, loading } = useAdminUser();
  const [account, setAccount] = useState<BusinessAccount | null>(null);
  const [error, setError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);
  const [documentOpening, setDocumentOpening] = useState<DocumentType | null>(null);
  const [kycSaving, setKycSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  useEffect(() => {
    if (!user || !params.accountId) return;

    async function loadAccount() {
      setAccountLoading(true);
      setError("");
      try {
        const data = await getBusinessAccount(params.accountId);
        setAccount(data.account);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load business account.");
      } finally {
        setAccountLoading(false);
      }
    }

    void loadAccount();
  }, [params.accountId, user]);

  async function handleViewDocument(documentType: DocumentType) {
    if (!account) return;

    setDocumentOpening(documentType);
    setError("");

    // Open the tab synchronously within the click gesture so browsers don't block
    // it as a popup; its location is set once the document blob has loaded.
    const documentWindow = window.open("", "_blank", "noopener,noreferrer");

    try {
      const blob = await getBusinessAccountDocument(account.accountId, documentType);
      const url = URL.createObjectURL(blob);

      if (documentWindow) {
        documentWindow.location.href = url;
      } else {
        // Popup was blocked despite the synchronous open; fall back to same tab.
        window.location.assign(url);
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (caughtError) {
      documentWindow?.close();
      setError(caughtError instanceof Error ? caughtError.message : "Unable to open document.");
    } finally {
      setDocumentOpening(null);
    }
  }

  async function updateKycReview(update: Parameters<typeof updateBusinessAccountKycReview>[1]) {
    if (!account) return;

    setKycSaving(true);
    setError("");

    try {
      const data = await updateBusinessAccountKycReview(account.accountId, update);
      setAccount(data.account);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update KYC review.");
    } finally {
      setKycSaving(false);
    }
  }

  async function handleKycCheckChange(key: BusinessKycCheckKey, status: BusinessKycCheckStatus, note?: string | null) {
    await updateKycReview({ checks: { [key]: { status, note } } });
  }

  async function handleVerifyMandatoryChecks() {
    if (!account) return;

    const checks = getKycCheckRows(account).reduce((nextChecks, row) => ({
      ...nextChecks,
      [row.key]: { status: "verified" as BusinessKycCheckStatus }
    }), {} as Record<BusinessKycCheckKey, { status: BusinessKycCheckStatus }>);

    await updateKycReview({ checks, finalDecision: null, startReview: true });
  }

  async function handleStartKycReview() {
    if (!account) return;

    const checks = getKycCheckRows(account).reduce((nextChecks, row) => ({
      ...nextChecks,
      [row.key]: { status: "under_review" as BusinessKycCheckStatus }
    }), {} as Record<BusinessKycCheckKey, { status: BusinessKycCheckStatus }>);

    await updateKycReview({ checks, finalDecision: null, startReview: true });
  }

  async function handleRejectKyc() {
    if (!account) return;

    const checks = getKycCheckRows(account).reduce((nextChecks, row) => ({
      ...nextChecks,
      [row.key]: { status: "reject" as BusinessKycCheckStatus }
    }), {} as Record<BusinessKycCheckKey, { status: BusinessKycCheckStatus }>);

    await updateKycReview({ checks, finalDecision: "rejected", startReview: true });
  }

  if (loading || !user || accountLoading) return <DashboardLoading />;

  if (!account) {
    return (
      <DashboardShell user={user}>
        <div className="rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 p-5">
          <p className="text-sm font-semibold text-[#D71313]">{error || "Business account not found."}</p>
          <Link href="/dashboard/business-accounts" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#0D1282] hover:underline">
            <FiArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to Business Accounts
          </Link>
        </div>
      </DashboardShell>
    );
  }

  const missingDocuments = getRequiredDocumentLabels(account);

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents" },
    { key: "kyc", label: "KYC Review" },
    { key: "access", label: "Users & Access" }
  ];

  return (
    <DashboardShell user={user}>
      {/* Account header and navigation actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/dashboard/business-accounts" className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-[#0D1282]">
              <FiArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> All Business Accounts
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-950">{account.company.companyName}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getAccountStatusBadgeClasses(account.status)}`}>
                {formatStatus(account.status)}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-[#0D1282]">{account.accountId}</p>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard/business-accounts" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282]">
              <FiArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to List
            </Link>
            <Link href={`/dashboard/business-accounts/${account.accountId}/edit`} className="inline-flex items-center gap-2 rounded-lg bg-[#0D1282] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63]">
              <FiEdit2 aria-hidden="true" className="h-4 w-4" /> Edit Account
            </Link>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mt-5 flex flex-wrap gap-1 border-t border-slate-100 pt-4">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isActive ? "bg-[#0D1282] text-white shadow-sm shadow-[#0D1282]/25" : "text-slate-600 bg-slate-300 hover:bg-[#0D1282]/8 hover:text-[#0D1282]"
                }`}
              >
                {tab.label}
                {tab.key === "documents" && missingDocuments.length ? (
                  <span className={`h-2 w-2 rounded-full ${isActive ? "bg-white" : "bg-[#D71313]"}`} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error alert */}
      {error ? (
        <div className="mt-5 rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 px-4 py-3 text-sm font-medium text-[#D71313]">
          {error}
        </div>
      ) : null}

      <div className="mt-5">
        {activeTab === "overview" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <DetailSection title="Contact Details" rows={[
              ["Primary Contact", `${account.contact.firstName} ${account.contact.lastName}`],
              ["Email", account.contact.email],
              ["Mobile", `${account.contact.countryCode} ${account.contact.mobileNumber}`],
              ["Department", account.contact.department],
              ["Shipment Type", account.contact.shipmentTypes.map(formatShipmentType).join(", ")]
            ]} />

            <DetailSection title="Company Details" rows={[
              ["Registration Country", account.company.registrationCountry],
              [getRegistrationIdLabel(account), account.company.registrationId || "Not provided"],
              ...(account.company.secondaryRegistrationId ? [[registrationConfig[account.company.registrationCountry]?.secondaryLabel ?? "Additional Registration Code", account.company.secondaryRegistrationId]] : []),
              ["Registered Address", account.company.registeredAddress],
              ["City", account.company.city],
              ["State or Province", account.company.stateOrProvince],
              ["Postal Code", account.company.postalCode],
              ["Operating Countries", formatOperatingCountries(account)],
              ["Industry", account.company.industry],
              ["Website", account.company.website || "Not provided"],
              ["Monthly Volume", account.company.monthlyShipmentVolume],
              ["Requested Credit", account.company.requestedCreditLimit.amount === null ? "Not requested" : `${account.company.requestedCreditLimit.currency} ${account.company.requestedCreditLimit.amount}`]
            ]} />
          </div>
        ) : null}

        {activeTab === "documents" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-[#0D1282]">Documents</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documentSummaryRows
                .filter((row) => row.required || account.documents?.[row.key])
                .map((row) => (
                  <DocumentSummary
                    key={row.key}
                    label={row.label}
                    value={account.documents?.[row.key]?.originalName}
                    required={row.required}
                    opening={documentOpening === row.key}
                    onView={account.documents?.[row.key] ? () => void handleViewDocument(row.key) : undefined}
                  />
                ))}
            </div>
          </section>
        ) : null}

        {activeTab === "kyc" ? (
          <KycReviewPanel
            account={account}
            saving={kycSaving}
            onStart={() => void handleStartKycReview()}
            onVerifyAll={() => void handleVerifyMandatoryChecks()}
            onReject={() => void handleRejectKyc()}
            onCheckChange={(key, status, note) => void handleKycCheckChange(key, status, note)}
          />
        ) : null}

        {activeTab === "access" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <BusinessAccountAccessPanel account={account} />
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}

function getRequiredDocumentLabels(account: BusinessAccount) {
  const labels: string[] = [];
  if (!account.documents?.aadhaarCard) labels.push("Aadhaar Card");
  if (!account.documents?.panCard) labels.push("PAN Card Copy");

  return labels;
}

function getKycCheckRows(account: BusinessAccount): { key: BusinessKycCheckKey; label: string; helper: string }[] {
  const rows: { key: BusinessKycCheckKey; label: string; helper: string }[] = [
    { key: "contactDetails", label: "Contact Details", helper: "Name, email, mobile, department, and shipment type." },
    { key: "companyDetails", label: "Company Details", helper: "Registration, address, operating countries, industry, and website." },
    { key: "aadhaarCard", label: "Aadhaar Card", helper: account.documents?.aadhaarCard?.originalName || "Required document missing." },
    { key: "panCard", label: "PAN Card Copy", helper: account.documents?.panCard?.originalName || "Required document missing." }
  ];

  for (const row of documentSummaryRows.filter((item) => !item.required)) {
    if (account.documents?.[row.key]) {
      rows.push({
        key: row.key,
        label: row.label,
        helper: account.documents[row.key]?.originalName || "Uploaded optional document."
      });
    }
  }

  return rows;
}

function KycReviewPanel({
  account,
  saving,
  onStart,
  onVerifyAll,
  onReject,
  onCheckChange
}: {
  account: BusinessAccount;
  saving: boolean;
  onStart: () => void;
  onVerifyAll: () => void;
  onReject: () => void;
  onCheckChange: (key: BusinessKycCheckKey, status: BusinessKycCheckStatus, note?: string | null) => void;
}) {
  const overallStatus = account.kycReview?.overallStatus ?? "documents_pending";
  const missingDocuments = getRequiredDocumentLabels(account);
  const rows = getKycCheckRows(account);
  const additionalInfoReason = rows
    .map((row) => account.kycReview?.checks?.[row.key])
    .find((check) => normalizeKycCheckStatus(check?.status) === "information_required" && check?.note)
    ?.note;
  const [infoRequest, setInfoRequest] = useState<{ key: BusinessKycCheckKey; label: string } | null>(null);
  const [infoReason, setInfoReason] = useState("");
  const [infoReasonError, setInfoReasonError] = useState("");

  function closeInfoRequest() {
    setInfoRequest(null);
    setInfoReason("");
    setInfoReasonError("");
  }

  const infoDialogRef = useDialog<HTMLDivElement>(Boolean(infoRequest), closeInfoRequest);

  function handleSelectChange(row: { key: BusinessKycCheckKey; label: string }, status: BusinessKycCheckStatus) {
    if (status === "information_required") {
      setInfoRequest(row);
      setInfoReason("");
      setInfoReasonError("");
      return;
    }

    onCheckChange(row.key, status, null);
  }

  function handleSubmitInfoReason() {
    if (!infoRequest) return;

    const reason = infoReason.trim();
    if (!reason) {
      setInfoReasonError("Reason is required.");
      return;
    }

    if (reason.length > 50) {
      setInfoReasonError("Reason must be 50 characters or less.");
      return;
    }

    onCheckChange(infoRequest.key, "information_required", reason);
    setInfoRequest(null);
    setInfoReason("");
    setInfoReasonError("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0D1282]">KYC Review</h2>
          <p className="mt-1 text-sm text-slate-500">Review contact, company, and mandatory document checks before final verification.</p>
        </div>
        <div className="text-right">
          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${kycStatusStyles[overallStatus]}`}>
            {formatStatus(overallStatus)}
          </span>
          {overallStatus === "additional_information_required" && additionalInfoReason ? (
            <p className="mt-1.5 max-w-xs text-xs font-medium text-[#8a7a00]">{additionalInfoReason}</p>
          ) : null}
        </div>
      </div>

      {missingDocuments.length ? (
        <div className="mt-4 rounded-xl border border-[#F0DE36]/50 bg-[#F0DE36]/15 px-4 py-3 text-sm font-medium text-[#8a7a00]">
          Missing required documents: {missingDocuments.join(", ")}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#0D1282] text-xs uppercase tracking-wide text-white">
              <tr>
                <th className="px-4 py-3.5 font-semibold">Check</th>
                <th className="px-4 py-3.5 font-semibold">Review Status</th>
                <th className="px-4 py-3.5 font-semibold">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const value = normalizeKycCheckStatus(account.kycReview?.checks?.[row.key]?.status);

                return (
                  <tr key={row.key} className="transition-colors hover:bg-[#EEEDED]/40">
                    <td className="px-4 py-3.5 font-semibold text-slate-900">{row.label}</td>
                    <td className="px-4 py-3.5">
                      <div className="relative w-64">
                        <select
                          value={value}
                          onChange={(event) => handleSelectChange(row, event.target.value as BusinessKycCheckStatus)}
                          disabled={saving}
                          className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-11 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/15 disabled:opacity-60"
                        >
                          {kycCheckStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <FiChevronDown
                          aria-hidden="true"
                          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0D1282]"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500">{row.helper}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={saving}
          className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] disabled:opacity-60"
        >
          Start Review
        </button>
        <button
          type="button"
          onClick={onVerifyAll}
          disabled={saving || Boolean(missingDocuments.length)}
          className="rounded-lg bg-[#0D1282] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Verify Mandatory Checks
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={saving}
          className="rounded-lg bg-[#D71313] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#D71313]/20 transition hover:bg-[#b40f0f] disabled:opacity-60"
        >
          Reject KYC
        </button>
      </div>

      {infoRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D1282]/30 px-4 backdrop-blur-sm">
          <div ref={infoDialogRef} role="dialog" aria-modal="true" aria-label="Information required" tabIndex={-1} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl outline-none">
            <h3 className="text-base font-bold text-[#0D1282]">Information Required</h3>
            <p className="mt-1 text-sm text-slate-500">{infoRequest.label}</p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Reason
              <input
                value={infoReason}
                maxLength={50}
                onChange={(event) => {
                  setInfoReason(event.target.value);
                  setInfoReasonError("");
                }}
                className="mt-2 block h-10 w-full rounded-lg border border-slate-200 bg-[#EEEDED]/50 px-3 text-sm outline-none transition focus:border-[#0D1282] focus:bg-white focus:ring-2 focus:ring-[#0D1282]/15"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#D71313]">{infoReasonError}</p>
              <p className="text-xs font-semibold text-slate-500">{infoReason.length}/50</p>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeInfoRequest}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitInfoReason}
                className="rounded-lg bg-[#0D1282] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63]"
              >
                Save Reason
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailSection({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-bold text-[#0D1282]">{title}</h2>
      <dl className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[#EEEDED]/40 px-3.5 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium capitalize text-slate-800">{value || "\u2014"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DocumentSummary({
  label,
  value,
  required,
  helper,
  opening,
  onView
}: {
  label: string;
  value?: string;
  required?: boolean;
  helper?: string;
  opening?: boolean;
  onView?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 p-4 transition hover:border-[#0D1282]/30 hover:bg-[#EEEDED]/20">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0D1282]/8 text-[#0D1282]">
          {value ? <FiFileText aria-hidden="true" className="h-4 w-4" /> : <FiFile aria-hidden="true" className="h-4 w-4 text-slate-400" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {label} {required ? <span className="text-[#D71313]">*</span> : null}
          </p>
          <p className="mt-1 truncate text-sm text-slate-600">{value || "Not uploaded"}</p>
        </div>
      </div>
      {helper ? <p className="mt-2 text-xs text-slate-400">{helper}</p> : null}
      {onView ? (
        <button
          type="button"
          onClick={onView}
          disabled={opening}
          className="mt-4 self-start rounded-lg border border-[#0D1282] px-3 py-2 text-sm font-semibold text-[#0D1282] transition hover:bg-[#0D1282]/5 disabled:opacity-60"
        >
          {opening ? "Opening..." : "View Document"}
        </button>
      ) : null}
    </div>
  );
}