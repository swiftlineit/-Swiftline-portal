"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
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
  documents_pending: "border-amber-200 bg-amber-50 text-amber-800",
  submitted: "border-blue-200 bg-blue-50 text-blue-800",
  under_review: "border-indigo-200 bg-indigo-50 text-indigo-800",
  additional_information_required: "border-orange-200 bg-orange-50 text-orange-800",
  verified: "border-green-200 bg-green-50 text-green-800",
  rejected: "border-red-200 bg-red-50 text-red-800"
};

function normalizeKycCheckStatus(status?: string): BusinessKycCheckStatus {
  if (status === "failed") return "reject";
  if (status === "replacement_required" || status === "mismatched" || status === "unclear") return "information_required";
  if (kycCheckStatusOptions.some((option) => option.value === status)) return status as BusinessKycCheckStatus;
  return "not_started";
}

export default function BusinessAccountDetailsPage() {
  const params = useParams<{ accountId: string }>();
  const { user, loading } = useAdminUser();
  const [account, setAccount] = useState<BusinessAccount | null>(null);
  const [error, setError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);
  const [documentOpening, setDocumentOpening] = useState<DocumentType | null>(null);
  const [kycSaving, setKycSaving] = useState(false);

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

    try {
      const blob = await getBusinessAccountDocument(account.accountId, documentType);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (caughtError) {
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

  if (loading || !user || accountLoading) return <BusinessAccountsLoading />;

  if (!account) {
    return (
      <BusinessAccountsShell user={user}>
        <div className="border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-semibold text-red-700">{error || "Business account not found."}</p>
          <Link href="/dashboard/business-accounts" className="mt-4 inline-block text-sm font-semibold text-blue-900">
            Back to Business Accounts
          </Link>
        </div>
      </BusinessAccountsShell>
    );
  }

  return (
    <BusinessAccountsShell user={user}>
      {/* Account header and navigation actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-900">{account.accountId}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">{account.company.companyName}</h1>
          <p className="mt-1 text-sm capitalize text-slate-500">Status: {formatStatus(account.status)}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/business-accounts" className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
            Back to List
          </Link>
          <Link href={`/dashboard/business-accounts/${account.accountId}/edit`} className="border border-blue-900 px-4 py-2 text-sm font-semibold text-blue-900">
            Edit Account
          </Link>
        </div>
      </div>

      {/* Error alert */}
      {error ? <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Contact details */}
        <DetailSection title="Contact Details" rows={[
          ["Primary Contact", `${account.contact.firstName} ${account.contact.lastName}`],
          ["Email", account.contact.email],
          ["Mobile", `${account.contact.countryCode} ${account.contact.mobileNumber}`],
          ["Department", account.contact.department],
          ["Shipment Type", account.contact.shipmentTypes.map(formatShipmentType).join(", ")]
        ]} />

        {/* Company details */}
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

        {/* Uploaded documents */}
        <section className="border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-slate-950">Documents</h2>
          <div className="grid gap-3 md:grid-cols-3">
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

        {/* KYC review actions */}
        <KycReviewPanel
          account={account}
          saving={kycSaving}
          onStart={() => void handleStartKycReview()}
          onVerifyAll={() => void handleVerifyMandatoryChecks()}
          onReject={() => void handleRejectKyc()}
          onCheckChange={(key, status, note) => void handleKycCheckChange(key, status, note)}
        />
      </div>
    </BusinessAccountsShell>
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
    <section className="border border-slate-200 bg-white p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">KYC Review</h2>
          <p className="mt-1 text-sm text-slate-500">Review contact, company, and mandatory document checks before final verification.</p>
        </div>
        <div className="text-right">
          <span className={`inline-block border px-3 py-2 text-sm font-semibold capitalize ${kycStatusStyles[overallStatus]}`}>
            {formatStatus(overallStatus)}
          </span>
          {overallStatus === "additional_information_required" && additionalInfoReason ? (
            <p className="mt-1 max-w-xs text-xs font-semibold text-orange-700">{additionalInfoReason}</p>
          ) : null}
        </div>
      </div>

      {missingDocuments.length ? (
        <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Missing required documents: {missingDocuments.join(", ")}
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Check</th>
              <th className="px-4 py-3">Review Status</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = normalizeKycCheckStatus(account.kycReview?.checks?.[row.key]?.status);

              return (
                <tr key={row.key} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.label}</td>
                  <td className="px-4 py-3">
                    <div className="relative w-64">
                      <select
                        value={value}
                        onChange={(event) => handleSelectChange(row, event.target.value as BusinessKycCheckStatus)}
                        disabled={saving}
                        className="h-10 w-full appearance-none border border-slate-300 bg-white px-3 pr-11 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                      >
                        {kycCheckStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <FiChevronDown
                        aria-hidden="true"
                        className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{row.helper}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={saving}
          className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900 disabled:opacity-60"
        >
          Start Review
        </button>
        <button
          type="button"
          onClick={onVerifyAll}
          disabled={saving || Boolean(missingDocuments.length)}
          className="bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
        >
          Verify Mandatory Checks
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={saving}
          className="bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          Reject KYC
        </button>
      </div>

      {infoRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-950">Information Required</h3>
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
                className="mt-2 block h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-red-600">{infoReasonError}</p>
              <p className="text-xs font-semibold text-slate-500">{infoReason.length}/50</p>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setInfoRequest(null);
                  setInfoReason("");
                  setInfoReasonError("");
                }}
                className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitInfoReason}
                className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white"
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
    <section className="border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-950">{title}</h2>
      <dl className="grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
            <dt className="text-xs font-semibold uppercase text-slate-400">{label}</dt>
            <dd className="text-sm text-slate-700">{value}</dd>
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
    <div className="border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </p>
      <p className="mt-2 text-sm text-slate-600">{value || "Not uploaded"}</p>
      {helper ? <p className="mt-2 text-xs text-slate-400">{helper}</p> : null}
      {onView ? (
        <button
          type="button"
          onClick={onView}
          disabled={opening}
          className="mt-4 border border-blue-900 px-3 py-2 text-sm font-semibold text-blue-900 disabled:opacity-60"
        >
          {opening ? "Opening..." : "View Document"}
        </button>
      ) : null}
    </div>
  );
}
