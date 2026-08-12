"use client";

import { useEffect, useRef, useState } from "react";
import { FiFile, FiUploadCloud } from "react-icons/fi";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import { formatDashboardDateTime } from "@/lib/dateFormat";

/**
 * Documents the customer sends after a shipment is booked, which is when
 * customs asks for them.
 *
 * Separate from the KYC pack shown above it: that is the record of how the
 * shipment was booked and must not change afterwards. This is new evidence for
 * a shipment already in the air, and Operations is told the moment it lands.
 */

const documentTypes = [
  { value: "COMMERCIAL_INVOICE", label: "Commercial Invoice" },
  { value: "PACKING_LIST", label: "Packing List" },
  { value: "CUSTOMS_DECLARATION", label: "Customs Declaration" },
  { value: "AUTHORISATION_LETTER", label: "Authorisation Letter" },
  { value: "PRODUCT_CERTIFICATE", label: "Product Certificate" },
  { value: "OTHER", label: "Other Supporting Document" }
] as const;

type SupportingDocument = {
  id: string;
  documentType: string;
  documentLabel: string;
  originalName: string;
  size: number;
  note: string;
  uploadedAt: string;
};

async function authorizedFetch(path: string, init: RequestInit = {}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(apiUrl(path), { ...init, headers });
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(apiUrl(path), { ...init, headers });
    }
  }
  return response;
}

export default function ShipmentSupportingDocuments({ draftId }: { draftId: string }) {
  const [documents, setDocuments] = useState<SupportingDocument[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [requested, setRequested] = useState(false);
  const [documentType, setDocumentType] = useState<string>("COMMERCIAL_INVOICE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    authorizedFetch(`/api/v1/client/shipments/${draftId}/documents`)
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data.success) return;
        setDocuments(data.documents);
        setCanUpload(Boolean(data.canUpload));
        setRequested(Boolean(data.documentsRequested));
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, [draftId]);

  async function upload(file: File | undefined) {
    if (!file || busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    const body = new FormData();
    body.append("document", file);
    body.append("documentType", documentType);
    body.append("note", note);

    try {
      const response = await authorizedFetch(`/api/v1/client/shipments/${draftId}/documents`, {
        method: "POST",
        body
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Upload failed.");

      setDocuments(data.documents);
      setMessage(data.message);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show before booking: the KYC pack covers that stage.
  if (!canUpload && !documents.length) return null;

  return (
    <section
      className={`rounded-2xl border bg-white p-5 ${
        requested ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Customs &amp; supporting documents
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {requested
              ? "This shipment is on hold. Upload what has been asked for and Swiftline Operations is notified straight away."
              : "Send Swiftline any document this shipment needs after booking."}
          </p>
        </div>
      </div>

      {canUpload ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Document type</span>
            <select
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              {documentTypes.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Note <span className="font-normal normal-case text-slate-400">(optional)</span>
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Anything Operations should know about this document"
              className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-900"
            />
          </label>

          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void upload(event.dataTransfer.files?.[0]);
            }}
            className={`sm:col-span-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragging ? "border-[#0D1282] bg-[#0D1282]/5" : "border-slate-300"
            }`}
          >
            <FiUploadCloud aria-hidden="true" className="h-6 w-6 text-slate-400" />
            <p className="mt-2 text-sm text-slate-600">
              Drag a file here, or{" "}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                className="font-semibold text-[#0D1282] hover:underline disabled:opacity-50"
              >
                choose a file
              </button>
            </p>
            <p className="mt-1 text-xs text-slate-400">PDF, JPG, PNG or WebP, up to 10 MB</p>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                // Cleared so re-picking the same file fires onChange again.
                event.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}

      {busy ? <p className="mt-3 text-sm text-slate-500">Uploading...</p> : null}
      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</p>
      ) : null}

      {documents.length ? (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 py-2.5">
              <FiFile aria-hidden="true" className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{document.originalName}</p>
                <p className="text-xs text-slate-500">
                  {document.documentLabel} · {formatDashboardDateTime(document.uploadedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
