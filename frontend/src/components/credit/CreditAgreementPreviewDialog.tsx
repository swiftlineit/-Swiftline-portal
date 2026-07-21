"use client";

import { useEffect, useRef, useState } from "react";
import { FiDownload, FiPrinter, FiX } from "react-icons/fi";
import { CreditAgreement, getAdminCreditAgreementPdf } from "@/lib/creditAgreements";

type Props = {
  agreement: CreditAgreement;
  onClose: () => void;
};

export default function CreditAgreementPreviewDialog({ agreement, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    getAdminCreditAgreementPdf(agreement.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to open the agreement PDF.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [agreement.id]);

  function download() {
    if (!pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = agreement.generatedDocument?.originalName || `${agreement.agreementNumber}.pdf`;
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Credit agreement preview">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="font-semibold text-slate-950">Credit Agreement</h2>
            <p className="mt-0.5 text-xs text-slate-500">{agreement.agreementNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => iframeRef.current?.contentWindow?.print()} disabled={!pdfUrl} title="Print agreement" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 disabled:opacity-50"><FiPrinter /></button>
            <button type="button" onClick={download} disabled={!pdfUrl} title="Download agreement" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700 disabled:opacity-50"><FiDownload /></button>
            <button type="button" onClick={onClose} title="Close preview" className="inline-flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-700"><FiX /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1 bg-slate-100 p-3">
          {error ? <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
          {!error && !pdfUrl ? <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">Preparing agreement preview...</div> : null}
          {pdfUrl ? <iframe ref={iframeRef} src={pdfUrl} title={`${agreement.agreementNumber} PDF`} className="h-full w-full border-0 bg-white" /> : null}
        </div>
      </div>
    </div>
  );
}
