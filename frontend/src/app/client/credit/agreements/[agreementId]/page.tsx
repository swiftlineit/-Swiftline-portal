"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FiCheckCircle, FiDownload, FiPrinter } from "react-icons/fi";
import { toast } from "react-toastify";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import {
  CreditAgreement,
  getClientCreditAgreement,
  getClientCreditAgreementPdf,
  signClientCreditAgreement
} from "@/lib/creditAgreements";
import { useClientUser } from "@/lib/useClientUser";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The credit agreement could not be loaded.";
}

export default function ClientCreditAgreementPage() {
  const { agreementId } = useParams<{ agreementId: string }>();
  const { user, loading: userLoading } = useClientUser();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pdfObjectUrlRef = useRef("");
  const [agreement, setAgreement] = useState<CreditAgreement | null>(null);
  const [canSign, setCanSign] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [signerName, setSignerName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !agreementId) return;
    let active = true;
    (async () => {
      try {
        const details = await getClientCreditAgreement(agreementId);
        if (!active) return;

        setAgreement(details.agreement);
        setCanSign(details.canSign);
        setSignerName(user.name || "");

        if (details.agreement.status !== "DRAFT") {
          const pdf = await getClientCreditAgreementPdf(agreementId);
          if (!active) return;
          const objectUrl = URL.createObjectURL(pdf);
          pdfObjectUrlRef.current = objectUrl;
          setPdfUrl(objectUrl);
        }
      } catch (loadError: unknown) {
        if (active) toast.error(message(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
    };
  }, [agreementId, user]);

  async function replacePdf() {
    const pdf = await getClientCreditAgreementPdf(agreementId);
    const nextUrl = URL.createObjectURL(pdf);
    if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
    pdfObjectUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signerName.trim().length < 2) return toast.error("Enter the authorised signer's full name.");
    if (jobTitle.trim().length < 2) return toast.error("Enter the authorised signer's designation.");
    if (!accepted) return toast.error("Confirm that you have read and accept the credit agreement.");

    setSubmitting(true);
    try {
      const result = await signClientCreditAgreement(agreementId, {
        signerName: signerName.trim(),
        jobTitle: jobTitle.trim(),
        accepted: true
      });
      setAgreement(result.agreement);
      toast.success(result.message);
      await replacePdf();
    } catch (signError) {
      toast.error(message(signError));
    } finally {
      setSubmitting(false);
    }
  }

  function download() {
    if (!agreement || !pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = agreement.signedDocument?.originalName || agreement.generatedDocument?.originalName || `${agreement.agreementNumber}.pdf`;
    link.click();
  }

  if (userLoading || !user) return <ClientDashboardLoading />;
  const isSigned = agreement?.status === "SIGNED";

  return (
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Credit Agreement</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">{agreement?.agreementNumber || "Agreement Review"}</h1>
            {agreement ? <p className="mt-1 text-sm text-slate-500">Version {agreement.version} | Terms {agreement.termsVersion}</p> : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => iframeRef.current?.contentWindow?.print()} disabled={!pdfUrl} title="Print agreement" className="inline-flex h-10 items-center gap-2 border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><FiPrinter /> Print</button>
            <button type="button" onClick={download} disabled={!pdfUrl} title="Download agreement" className="inline-flex h-10 items-center gap-2 border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><FiDownload /> Download</button>
          </div>
        </header>


        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="h-[74vh] min-h-[560px] border border-slate-200 bg-slate-100 p-2">
            {loading ? <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">Loading agreement...</div> : null}
            {!loading && agreement?.status === "DRAFT" && !pdfUrl ? (
              <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm leading-6 text-slate-600">
                This agreement is still being prepared. Once the draft is generated, the full document preview will appear here.
              </div>
            ) : null}
            {pdfUrl ? <iframe ref={iframeRef} src={pdfUrl} title="Credit agreement PDF" className="h-full w-full border-0 bg-white" /> : null}
          </section>

          <aside className="self-start border border-slate-200 bg-white p-5">
            {isSigned ? (
              <div>
                <div className="flex h-10 w-10 items-center justify-center border border-emerald-200 bg-emerald-50 text-emerald-700"><FiCheckCircle /></div>
                <h2 className="mt-4 text-lg font-semibold text-slate-950">Agreement Signed</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Signed by {agreement.signer?.name || "authorised customer"} on {agreement.signedAt ? new Date(agreement.signedAt).toLocaleDateString("en-GB").replaceAll("/", "-") : "the recorded date"}.</p>
              </div>
            ) : canSign && agreement?.status !== "DRAFT" ? (
              <form onSubmit={sign}>
                <h2 className="text-lg font-semibold text-slate-950">Sign Agreement</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Review the full document before accepting it for this business account.</p>
                <label className="mt-5 block text-sm font-semibold text-slate-700">Authorised signer name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal text-slate-950 focus:border-blue-500 focus:outline-none" /></label>
                <label className="mt-4 block text-sm font-semibold text-slate-700">Designation<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Director, Owner or Authorised Signatory" className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal text-slate-950 focus:border-blue-500 focus:outline-none" /></label>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-5 text-slate-700"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 h-4 w-4" /><span>I have read this agreement and the <Link href="/client/credit/payment-terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-900 underline">payment terms</Link>, and I am authorised to accept them for this business account.</span></label>
                <button disabled={submitting || !agreement} className="mt-5 h-11 w-full bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Signing..." : "Accept and Sign"}</button>
              </form>
            ) : (
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Review Agreement</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{agreement?.status === "DRAFT" ? "The agreement draft is ready for review. The document preview will appear once generation is complete." : "Only the account owner or account admin can sign. You can review and download this agreement."}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
  );
}
