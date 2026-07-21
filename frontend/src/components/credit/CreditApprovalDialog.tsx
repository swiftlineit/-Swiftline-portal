"use client";

import { FormEvent, useState } from "react";
import { FiX } from "react-icons/fi";
import { approveCreditAccount, CreditAccount, CreditApprovalInput, MAX_CREDIT_LIMIT_RUPEES } from "@/lib/creditAccounts";

type FormState = {
  limitRupees: string; paymentTermsDays: CreditApprovalInput["paymentTermsDays"];
  billingCycle: CreditApprovalInput["billingCycle"]; validFrom: string; validUntil: string;
  gracePeriodDays: string; maxOverdueDays: string; warningPercent: string;
  depositRupees: string; riskCategory: CreditApprovalInput["riskCategory"];
  internalRemarks: string; reason: string;
};

const inputClass = "h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-900/10";
const allowedPaymentTerms = [0, 7, 15, 30, 45] as const;

function normalizePaymentTerms(value: number): CreditApprovalInput["paymentTermsDays"] {
  return allowedPaymentTerms.find((days) => days === value) ?? 30;
}

function initialState(account: CreditAccount): FormState {
  return {
    limitRupees: String((account.approvedCreditLimitMinor || account.requestedCreditLimitMinor || 0) / 100 || ""),
    paymentTermsDays: normalizePaymentTerms(account.paymentTermsDays),
    billingCycle: account.billingCycle || "MONTHLY",
    validFrom: account.validFrom?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    validUntil: account.validUntil?.slice(0, 10) || "",
    gracePeriodDays: String(account.gracePeriodDays ?? 0), maxOverdueDays: String(account.maxOverdueDays ?? 30),
    warningPercent: String(account.creditWarningThresholdPercent ?? 70),
    depositRupees: String((account.securityDepositRequiredMinor || 0) / 100 || ""),
    riskCategory: account.riskCategory || "MEDIUM", internalRemarks: account.internalRemarks || "", reason: ""
  };
}

export default function CreditApprovalDialog({ account, onClose, onSaved }: {
  account: CreditAccount; onClose: () => void; onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState(() => initialState(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const company = account.businessAccount?.companyName || account.businessAccount?.accountId || "Business account";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const limitMinor = Math.round(Number(form.limitRupees) * 100);
    const depositMinor = Math.round(Number(form.depositRupees || 0) * 100);
    if (!Number.isInteger(limitMinor) || limitMinor <= 0) { setError("Enter an approved credit limit greater than zero."); return; }
    if (Number(form.limitRupees) > MAX_CREDIT_LIMIT_RUPEES) { setError("Approved credit limit cannot exceed INR 1,00,000."); return; }
    if (!Number.isInteger(depositMinor) || depositMinor < 0) { setError("Enter a valid security deposit amount."); return; }
    if (form.reason.trim().length < 5) { setError("Provide a reason for this credit decision."); return; }

    setBusy(true); setError("");
    try {
      const result = await approveCreditAccount(account.businessAccountId, {
        approvedCreditLimitMinor: limitMinor, paymentTermsDays: form.paymentTermsDays,
        billingCycle: form.billingCycle, validFrom: form.validFrom, validUntil: form.validUntil,
        gracePeriodDays: Number(form.gracePeriodDays), maxOverdueDays: Number(form.maxOverdueDays),
        creditWarningThresholdPercent: Number(form.warningPercent), securityDepositRequiredMinor: depositMinor,
        riskCategory: form.riskCategory, internalRemarks: form.internalRemarks, reason: form.reason
      });
      await onSaved(result.message);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to approve this credit facility.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="credit-approval-title">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div><p className="text-xs font-semibold uppercase text-slate-500">Credit Facility</p><h2 id="credit-approval-title" className="mt-1 text-xl font-semibold text-slate-950">{company}</h2><p className="mt-1 text-sm text-slate-500">{account.businessAccount?.accountId}</p></div>
          <button type="button" onClick={onClose} disabled={busy} title="Close" aria-label="Close" className="flex h-9 w-9 items-center justify-center border border-slate-200 text-slate-600 hover:border-slate-500"><FiX aria-hidden="true" /></button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-5">
          {account.requestReason ? <div className="border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-700">Customer Request</p><p className="mt-2 text-sm text-amber-900">{account.requestReason}</p></div> : null}
          {error ? <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Approved Limit (INR)"><input type="number" min="1" max={MAX_CREDIT_LIMIT_RUPEES} step="0.01" value={form.limitRupees} onChange={(event) => setForm({ ...form, limitRupees: event.target.value })} className={inputClass} /></Field>
            <Field label="Payment Terms"><select value={form.paymentTermsDays} onChange={(event) => setForm({ ...form, paymentTermsDays: normalizePaymentTerms(Number(event.target.value)) })} className={inputClass}>{allowedPaymentTerms.map((days) => <option key={days} value={days}>{days ? `${days} days` : "Due immediately"}</option>)}</select></Field>
            <Field label="Billing Cycle"><select value={form.billingCycle} onChange={(event) => setForm({ ...form, billingCycle: event.target.value as FormState["billingCycle"] })} className={inputClass}><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></Field>
            <Field label="Valid From"><input type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} className={inputClass} /></Field>
            <Field label="Valid Until"><input type="date" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} className={inputClass} /></Field>
            <Field label="Risk Category"><select value={form.riskCategory} onChange={(event) => setForm({ ...form, riskCategory: event.target.value as FormState["riskCategory"] })} className={inputClass}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></Field>
            <Field label="Grace Period (Days)"><input type="number" min="0" max="90" value={form.gracePeriodDays} onChange={(event) => setForm({ ...form, gracePeriodDays: event.target.value })} className={inputClass} /></Field>
            <Field label="Maximum Overdue Days"><input type="number" min="0" max="365" value={form.maxOverdueDays} onChange={(event) => setForm({ ...form, maxOverdueDays: event.target.value })} className={inputClass} /></Field>
            <Field label="Warning Threshold (%)"><input type="number" min="1" max="100" value={form.warningPercent} onChange={(event) => setForm({ ...form, warningPercent: event.target.value })} className={inputClass} /></Field>
            <Field label="Required Deposit (INR)"><input type="number" min="0" step="0.01" value={form.depositRupees} onChange={(event) => setForm({ ...form, depositRupees: event.target.value })} className={inputClass} /></Field>
          </div>
          <Field label="Internal Remarks"><textarea rows={3} value={form.internalRemarks} onChange={(event) => setForm({ ...form, internalRemarks: event.target.value })} className="min-h-24 w-full border border-slate-300 p-3 text-sm outline-none focus:border-blue-900" /></Field>
          <Field label="Decision Reason"><textarea required rows={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="min-h-24 w-full border border-slate-300 p-3 text-sm outline-none focus:border-blue-900" /></Field>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={onClose} disabled={busy} className="h-10 border border-slate-300 px-4 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={busy} className="h-10 bg-blue-900 px-5 text-sm font-semibold text-white disabled:bg-slate-400">{busy ? "Saving..." : "Approve Credit"}</button></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{label}</span>{children}</label>;
}
