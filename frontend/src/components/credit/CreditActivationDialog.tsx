"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { FiCheckCircle, FiDownload, FiPrinter, FiX } from "react-icons/fi";
import {
  CreditAgreement,
  getAdminCreditAgreementPdf,
  prepareAdminCreditActivationAgreement
} from "@/lib/creditAgreements";
import { activateCreditAccount, CreditAccount, formatCreditMoney } from "@/lib/creditAccounts";

type Props = {
  account: CreditAccount;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
};

export default function CreditActivationDialog({ account, onClose, onSaved }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pdfObjectUrlRef = useRef("");
  const [agreement, setAgreement] = useState<CreditAgreement | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const company = account.businessAccount?.companyName || account.businessAccount?.accountId || "Business account";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await prepareAdminCreditActivationAgreement(account.businessAccountId);
        if (!active) return;
        setAgreement(result.agreement);
        const pdf = await getAdminCreditAgreementPdf(result.agreement.id);
        if (!active) return;
        const objectUrl = URL.createObjectURL(pdf);
        pdfObjectUrlRef.current = objectUrl;
        setPdfUrl(objectUrl);
      } catch (caughtError) {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to prepare the credit agreement.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
    };
  }, [account.businessAccountId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreement || !accepted) {
      setError("Confirm that you have reviewed and approved the credit agreement.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await activateCreditAccount(account.businessAccountId, {
        agreementId: agreement.id,
        accepted: true
      });
      await onSaved(result.message);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to sign and activate this credit facility.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!pdfUrl || !agreement) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = agreement.signedDocument?.originalName || agreement.generatedDocument?.originalName || `${agreement.agreementNumber}.pdf`;
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="credit-activation-title">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 id="credit-activation-title" className="font-semibold text-slate-950">Review and activate credit</h2>
            <p className="mt-0.5 text-xs text-slate-500">{company} {agreement ? `· ${agreement.agreementNumber}` : "· Preparing agreement"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => iframeRef.current?.contentWindow?.print()} disabled={!pdfUrl} title="Print agreement" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 disabled:opacity-50"><FiPrinter /></button>
            <button type="button" onClick={download} disabled={!pdfUrl} title="Download agreement" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 disabled:opacity-50"><FiDownload /></button>
            <button type="button" onClick={onClose} disabled={busy} title="Close" aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 disabled:opacity-50"><FiX /></button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-0 bg-slate-100 p-3">
            {loading ? <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">Preparing agreement preview...</div> : null}
            {!loading && error && !pdfUrl ? <div className="flex h-full items-center justify-center p-6 text-center text-sm font-medium text-red-700">{error}</div> : null}
            {pdfUrl ? <iframe ref={iframeRef} src={pdfUrl} title="Credit agreement PDF" className="h-full min-h-[420px] w-full border-0 bg-white" /> : null}
          </section>

          <form onSubmit={submit} className="flex min-h-0 flex-col border-l border-slate-200 bg-white p-5">
            <div className="flex-1 overflow-y-auto">
              <div className="flex h-10 w-10 items-center justify-center border border-blue-200 bg-blue-50 text-blue-900"><FiCheckCircle /></div>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">Administrator approval</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review the agreement and confirm the approved facility before activating credit for this account.
              </p>
              {agreement ? (
                <div className="mt-5 space-y-2 border-y border-slate-200 py-4 text-sm text-slate-600">
                  <div className="flex justify-between gap-3"><span>Approved limit</span><strong className="text-slate-950">{formatCreditMoney(agreement.snapshot.credit.approvedCreditLimitMinor)}</strong></div>
                  <div className="flex justify-between gap-3"><span>Payment terms</span><strong className="text-slate-950">{agreement.snapshot.credit.paymentTermsDays ? `${agreement.snapshot.credit.paymentTermsDays} days` : "Due immediately"}</strong></div>
                </div>
              ) : null}
              <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-700">
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy || loading} className="mt-1 h-4 w-4" />
                <span>I confirm that I have reviewed and approved this credit agreement and authorize activation of this credit facility.</span>
              </label>
            </div>

            <div className="mt-5 shrink-0 border-t border-slate-200 pt-4">
              {error && pdfUrl ? <p role="alert" className="mb-3 text-sm font-semibold text-red-700">{error}</p> : null}
              <button type="submit" disabled={busy || loading || !agreement || !accepted} className="h-11 w-full rounded-lg bg-[#0D1282] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Activating..." : "Sign & Activate"}
              </button>
              <button type="button" onClick={onClose} disabled={busy} className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
