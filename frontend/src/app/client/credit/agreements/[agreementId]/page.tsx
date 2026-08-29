"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { FiCheckCircle, FiDownload, FiPrinter } from "react-icons/fi";
import { toast } from "react-toastify";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import {
  CreditAgreement,
  getClientCreditAgreement,
  getClientCreditAgreementPdf
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
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !agreementId) return;
    let active = true;
    (async () => {
      try {
        const details = await getClientCreditAgreement(agreementId);
        if (!active) return;

        setAgreement(details.agreement);

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
      <div className="mx-auto max-w-8xl space-y-4">
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
                <p className="mt-2 text-sm leading-6 text-slate-600">Signed by {agreement.signer?.name || "a Swiftline administrator"} on {agreement.signedAt ? new Date(agreement.signedAt).toLocaleDateString("en-GB").replaceAll("/", "-") : "the recorded date"}.</p>
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Review Agreement</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{agreement?.status === "DRAFT" ? "The agreement draft is ready for review. The document preview will appear once generation is complete." : "Swiftline will complete the signing during activation. You can review and download the approved terms."}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
  );
}
