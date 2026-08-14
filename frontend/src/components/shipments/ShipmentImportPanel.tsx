"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { FiDownload, FiFileText, FiUploadCloud } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  createShipmentImportDrafts,
  downloadShipmentImportTemplate,
  previewShipmentImports,
  type ShipmentImportBatch
} from "@/lib/shipmentImports";

export default function ShipmentImportPanel({
  audience,
  businessAccountId,
  branchId,
  disabled = false,
  onDraftsCreated
}: {
  audience: "admin" | "client";
  businessAccountId?: string;
  branchId: string;
  disabled?: boolean;
  onDraftsCreated?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [batch, setBatch] = useState<ShipmentImportBatch | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  const selectableEntries = useMemo(() => batch?.entries.filter((entry) => (
    entry.status === "READY" || entry.status === "NEEDS_REVIEW" || entry.status === "CREATE_FAILED"
  )) ?? [], [batch]);

  function acceptFiles(next: File[]) {
    const workbooks = next.filter((file) => file.name.toLowerCase().endsWith(".xlsx")).slice(0, 25);
    setFiles(workbooks);
    setBatch(null);
    setSelected([]);
    setError(workbooks.length === next.length ? "" : "Only .xlsx files are supported; a maximum of 25 files can be selected.");
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFiles(Array.from(event.target.files ?? []));
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!disabled) acceptFiles(Array.from(event.dataTransfer.files));
  }

  async function downloadTemplate() {
    setBusy(true);
    setError("");
    try {
      const blob = await downloadShipmentImportTemplate(audience);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "swiftline-shipment-import-template.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to download the shipment import template.");
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!branchId || !files.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await previewShipmentImports({ audience, businessAccountId, branchId, files });
      setBatch(result.batch);
      setSelected(result.batch.entries.filter((entry) => entry.status === "READY" || entry.status === "NEEDS_REVIEW").map((entry) => entry.id));
      toast.success(`${result.batch.fileCount} shipment workbook${result.batch.fileCount === 1 ? "" : "s"} checked.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Shipment workbooks could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  async function createDrafts() {
    if (!batch || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await createShipmentImportDrafts({
        audience,
        batchId: batch.id,
        entryIds: selected,
        idempotencyKey: crypto.randomUUID()
      });
      setBatch(result.batch);
      setSelected([]);
      setFiles([]);
      setInputKey((current) => current + 1);
      toast.success(`${result.batch.createdCount} shipment draft${result.batch.createdCount === 1 ? "" : "s"} created.`);
      onDraftsCreated?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Shipment drafts could not be created.");
    } finally {
      setBusy(false);
    }
  }

  function draftHref(draftId: string) {
    return audience === "client" ? `/client/dpd-labels/${draftId}` : `/dashboard/dpd-labels/${draftId}`;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-600">Shipment Import</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Upload 1–25 workbooks. This only prefills editable drafts; it does not book or charge.</p>
        </div>
        <button type="button" onClick={downloadTemplate} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-300 px-3 text-xs font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50">
          <FiDownload className="h-4 w-4" /> Download Template
        </button>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div> : null}

      <label
        onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`mt-4 flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${dragActive ? "border-blue-900 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
      >
        <FiUploadCloud className="h-7 w-7 text-blue-900" />
        <span className="mt-2 text-sm font-semibold text-slate-900">{files.length ? `${files.length} workbook${files.length === 1 ? "" : "s"} selected` : "Drop shipment .xlsx files here"}</span>
        <span className="mt-1 text-xs text-slate-500">Each workbook creates one independent draft after confirmation.</span>
        <input key={inputKey} type="file" accept=".xlsx" multiple disabled={disabled} onChange={handleChange} className="hidden" />
      </label>

      <button type="button" onClick={preview} disabled={disabled || busy || !branchId || !files.length} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400">
        <FiFileText className="h-4 w-4" /> {busy ? "Working..." : "Check and Preview"}
      </button>

      {batch ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{batch.readyCount} ready</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">{batch.needsReviewCount} needs review</span>
            <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">{batch.invalidCount} invalid</span>
          </div>

          {/* What is actually wrong with the file, counted per reason.
              The per-row detail below answers "which row"; this answers "what
              do I need to fix", which is the question somebody holding a
              hundred-row spreadsheet is asking. */}
          {batch.issueSummary?.length ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                What needs fixing
              </p>
              <ul className="mt-2 space-y-1">
                {batch.issueSummary.map((issue) => (
                  <li key={issue.reason} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                      issue.blocking ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"
                    }`}>
                      {issue.count}
                    </span>
                    <span className="min-w-0 text-slate-700">
                      {issue.reason}
                      {issue.blocking ? (
                        <span className="ml-1 text-xs font-semibold text-red-700">— blocks import</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {batch.entries.map((entry) => {
              const selectable = ["READY", "NEEDS_REVIEW", "CREATE_FAILED"].includes(entry.status);
              return (
                <article key={entry.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4" disabled={!selectable || busy} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{entry.originalFilename}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.summary ? `${entry.summary.consignee || "Consignee missing"} · ${entry.summary.destination || "Destination missing"} · ${entry.summary.parcelCount} parcel(s) · ${entry.summary.itemCount} item(s) · ${entry.summary.totalWeightKg} KG` : "No readable shipment data"}</p>
                      {entry.summary?.references.length ? <p className="mt-1 truncate text-xs text-slate-500">Reference: {entry.summary.references.join(", ")}</p> : null}
                      {[...entry.errors, ...entry.warnings].length ? (
                        <ul className={`mt-2 list-disc space-y-1 pl-4 text-xs ${entry.errors.length ? "text-red-700" : "text-amber-700"}`}>
                          {[...entry.errors, ...entry.warnings].slice(0, 4).map((message, index) => <li key={index}>{message}</li>)}
                        </ul>
                      ) : null}
                      {entry.shipmentDraftId ? <Link href={draftHref(entry.shipmentDraftId)} className="mt-2 inline-flex text-xs font-semibold text-blue-900 hover:underline">Open draft</Link> : null}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${entry.status === "INVALID" || entry.status === "CREATE_FAILED" ? "bg-red-50 text-red-700" : entry.status === "NEEDS_REVIEW" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{entry.status.replaceAll("_", " ")}</span>
                  </div>
                </article>
              );
            })}
          </div>
          {selectableEntries.length ? (
            <button type="button" onClick={createDrafts} disabled={busy || !selected.length} className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600 disabled:bg-slate-400">
              {busy ? "Creating Drafts..." : `Create Selected Drafts (${selected.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
