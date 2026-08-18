"use client";

import { useRef, useState } from "react";
import { FiAlertCircle, FiCheck, FiFile, FiTrash2, FiUpload } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  claimDocumentLabels,
  deleteClaimDocument,
  openClaimDocument,
  uploadClaimDocument,
  type ClaimAudience,
  type ClaimChecklist,
  type ClaimDocumentCategory,
  type ClaimDocumentSummary
} from "@/lib/claims";

/**
 * The evidence checklist, and the upload control for each line of it.
 *
 * Shows what is required, what has arrived, and what was refused- a client who
 * can only see "documents missing" has no way to act on it.
 */

const stateStyles: Record<
  ClaimChecklist["items"][number]["state"],
  { label: string; className: string }
> = {
  MISSING: { label: "Needed", className: "border-amber-200 bg-amber-50 text-amber-800" },
  UPLOADED: { label: "Uploaded", className: "border-blue-200 bg-blue-50 text-blue-800" },
  ACCEPTED: { label: "Accepted", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  REJECTED: { label: "Rejected", className: "border-red-200 bg-red-50 text-red-700" },
  WAIVED: { label: "Waived", className: "border-slate-300 bg-slate-100 text-slate-600" },
  SOURCED_FROM_PORTAL: {
    label: "On file",
    className: "border-slate-300 bg-slate-100 text-slate-600"
  }
};

export default function ClaimEvidencePanel({
  claimId,
  checklist,
  documents,
  audience = "client",
  readOnly = false,
  onChanged
}: {
  claimId: string;
  checklist: ClaimChecklist;
  documents: ClaimDocumentSummary[];
  audience?: ClaimAudience;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  // Which row a dragged file is currently over, so it can show it will accept it.
  const [dropCategory, setDropCategory] = useState<string | null>(null);
  // One hidden input per category, so the file picker knows what it is filling.
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleUpload(category: ClaimDocumentCategory, file: File | undefined) {
    if (!file) return;
    setBusyCategory(category);
    try {
      const result = await uploadClaimDocument(claimId, category, file);
      toast.success(result.message);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The document could not be uploaded.");
    } finally {
      setBusyCategory(null);
    }
  }

  async function handleRemove(documentId: string) {
    setBusyCategory(documentId);
    try {
      await deleteClaimDocument(claimId, documentId);
      toast.success("Document removed.");
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The document could not be removed.");
    } finally {
      setBusyCategory(null);
    }
  }

  const extras = documents.filter(
    (document) => !checklist.items.some((item) => item.documentId === document._id)
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Evidence</h2>
          <p className="mt-1 text-xs text-slate-500">
            PDF, JPG, PNG or WebP. Up to 10 MB each.
          </p>
        </div>
        {checklist.complete ? (
          <span className="inline-flex items-center gap-1.5 rounded-4xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <FiCheck /> Complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-4xl border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            <FiAlertCircle /> {checklist.missingCount} outstanding
          </span>
        )}
      </header>

      <ul className="divide-y divide-slate-100">
        {checklist.items.map((item) => {
          const document = documents.find((entry) => entry._id === item.documentId);
          const style = stateStyles[item.state];
          const busy = busyCategory === item.category;

          return (
            <li
              key={item.category}
              // Each row is its own drop target, so a file lands against the
              // document it belongs to rather than a single pile the client
              // then has to categorise. Read-only rows accept nothing.
              onDragOver={readOnly ? undefined : (event) => {
                event.preventDefault();
                setDropCategory(item.category);
              }}
              onDragLeave={readOnly ? undefined : () => setDropCategory(null)}
              onDrop={readOnly ? undefined : (event) => {
                event.preventDefault();
                setDropCategory(null);
                void handleUpload(item.category, event.dataTransfer.files?.[0]);
              }}
              className={`flex flex-wrap items-center gap-3 px-5 py-3.5 transition ${
                dropCategory === item.category ? "bg-[#0D1282]/5 ring-1 ring-inset ring-[#0D1282]/30" : ""
              }`}
            >
              <FiFile className="shrink-0 text-slate-400" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {claimDocumentLabels[item.category]}
                  {item.required ? <span className="ml-1 text-red-600">*</span> : null}
                </p>
                {document ? (
                  <button
                    type="button"
                    onClick={() => void openClaimDocument(audience, claimId, document._id)}
                    className="mt-0.5 truncate text-xs font-medium text-blue-900 hover:underline"
                  >
                    {document.originalName}
                  </button>
                ) : null}
                {/* A rejection the client cannot see the reason for just costs
                    everyone another round of correspondence. */}
                {item.state === "REJECTED" && item.rejectionReason ? (
                  <p className="mt-0.5 text-xs text-red-700">{item.rejectionReason}</p>
                ) : null}
              </div>

              <span
                className={`inline-flex shrink-0 rounded-4xl border px-2.5 py-1 text-xs font-semibold uppercase ${style.className}`}
              >
                {style.label}
              </span>

              {readOnly ? null : (
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    ref={(element) => {
                      inputs.current[item.category] = element;
                    }}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(event) => {
                      void handleUpload(item.category, event.target.files?.[0]);
                      // Cleared so re-picking the same file fires onChange again.
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputs.current[item.category]?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <FiUpload />
                    {busy ? "Uploading..." : document ? "Replace" : "Upload"}
                  </button>
                  {document && item.state !== "ACCEPTED" ? (
                    <button
                      type="button"
                      onClick={() => void handleRemove(document._id)}
                      className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${document.originalName}`}
                    >
                      <FiTrash2 />
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {extras.length > 0 ? (
        <div className="border-t border-slate-200 px-5 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
            Other documents
          </p>
          <ul className="space-y-1.5">
            {extras.map((document) => (
              <li key={document._id}>
                <button
                  type="button"
                  onClick={() => void openClaimDocument(audience, claimId, document._id)}
                  className="text-sm font-medium text-blue-900 hover:underline"
                >
                  {document.originalName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
