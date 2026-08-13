"use client";

import { useEffect, useState } from "react";
import { FiDownload, FiFile, FiPaperclip } from "react-icons/fi";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import { formatDashboardDateTime } from "@/lib/dateFormat";

/**
 * What the customer sent after this shipment was booked.
 *
 * The counterpart to the client's upload panel. It exists because a document
 * that arrives with a notification and nowhere to open it is not a delivered
 * document — the operator clearing the hold needs the file itself.
 */

type SupportingDocument = {
  id: string;
  documentType: string;
  documentLabel: string;
  originalName: string;
  mimeType: string;
  size: number;
  note: string;
  uploadedAt: string;
  uploadedBy: string;
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

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function StaffSupportingDocuments({
  draftId,
  onHold = false
}: {
  draftId: string;
  /** Drives the highlight: on a held shipment these are what unblocks it. */
  onHold?: boolean;
}) {
  const [documents, setDocuments] = useState<SupportingDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    let active = true;

    authorizedFetch(`/api/v1/shipments/${draftId}/documents`)
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        if (data.success) setDocuments(data.documents);
        else setError(data.message || "Documents could not be loaded.");
      })
      .catch(() => { if (active) setError("Documents could not be loaded."); })
      .finally(() => { if (active) setLoaded(true); });

    return () => { active = false; };
  }, [draftId]);

  /**
   * Downloads through the authorised endpoint rather than a plain link.
   *
   * The file is behind a bearer token, so an anchor would return 401. Fetching
   * to a blob keeps the original filename on the saved file.
   */
  async function download(document_: SupportingDocument) {
    setBusyId(document_.id);
    setError("");

    try {
      const response = await authorizedFetch(`/api/v1/shipments/${draftId}/documents/${document_.id}`);
      if (!response.ok) throw new Error("Download failed.");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document_.originalName;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("That document could not be downloaded. Try again, or check storage access.");
    } finally {
      setBusyId("");
    }
  }

  // Nothing sent and nothing to say: the panel stays out of the way entirely.
  if (loaded && !documents.length && !error) return null;

  return (
    <section
      className={`rounded-2xl border bg-white p-5 ${
        onHold && documents.length ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <FiPaperclip aria-hidden="true" className="h-4 w-4" />
          Customer documents
        </h2>
        {documents.length ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {documents.length} received
          </span>
        ) : null}
      </div>

      {onHold && documents.length ? (
        <p className="mt-1 text-sm text-amber-800">
          Sent by the customer after booking. Review these before releasing the hold.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        {documents.map((document_) => (
          <li key={document_.id} className="flex flex-wrap items-center gap-3 py-3">
            <FiFile aria-hidden="true" className="shrink-0 text-slate-400" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{document_.originalName}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {document_.documentLabel} · {formatSize(document_.size)} ·{" "}
                {formatDashboardDateTime(document_.uploadedAt)}
                {document_.uploadedBy ? ` · ${document_.uploadedBy}` : ""}
              </p>
              {/* The customer's note is usually the whole point — "this is the
                  invoice customs asked for" — so it is shown, not hidden. */}
              {document_.note ? (
                <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                  “{document_.note}”
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void download(document_)}
              disabled={busyId === document_.id}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-4xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900 disabled:opacity-50"
            >
              <FiDownload aria-hidden="true" className="h-3.5 w-3.5" />
              {busyId === document_.id ? "Opening..." : "Download"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
