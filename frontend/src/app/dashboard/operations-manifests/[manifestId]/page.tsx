"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FiArchive, FiCheck, FiDownload, FiPlus, FiPrinter, FiRefreshCw, FiSend, FiTrash2, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import {
  createOperationsBag,
  downloadOperationsManifest,
  getOperationsManifest,
  removeOperationsScan,
  runBagAction,
  runManifestAction,
  scanOperationsParcel,
  setOperationsGoodsValue,
  type ManifestDetail,
  type OperationsBag,
  type OperationsConsignment
} from "@/lib/operationsManifests";
import { useAdminUser } from "@/lib/useAdminUser";

const isEditable = (status?: string) => ["DRAFT", "PACKING", "READY_TO_SEAL"].includes(status ?? "");
const formatMoney = (minor?: number | null) => typeof minor === "number"
  ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(minor / 100)
  : "Required";

type PendingReason = { title: string; run: (reason: string) => Promise<unknown> };

export default function OperationsManifestWorkspace() {
  const { manifestId } = useParams<{ manifestId: string }>();
  const { user, loading } = useAdminUser(true);
  const [data, setData] = useState<ManifestDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [activeBagId, setActiveBagId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await getOperationsManifest(manifestId);
      setData(result);
      setActiveBagId((current) => current && result.bags.some((bag) => bag.id === current)
        ? current
        : result.bags.find((bag) => ["OPEN", "REOPENED"].includes(bag.status))?.id ?? result.bags[0]?.id ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Manifest could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [manifestId]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load, user]);

  useEffect(() => {
    if (!scanning && !pendingReason) inputRef.current?.focus();
  }, [activeBagId, data?.scans.length, pendingReason, scanning]);

  if (loading || !user) return <BusinessAccountsLoading />;
  if (!data) return <BusinessAccountsShell user={user}><div className="p-10 text-center text-slate-500">{busy ? "Loading manifest..." : "Manifest is unavailable."}</div></BusinessAccountsShell>;

  const currentData = data;
  const manifest = data.manifest;
  const activeBag = data.bags.find((bag) => bag.id === activeBagId);
  const canEdit = isEditable(manifest.status);

  async function refreshAction(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action could not be completed.");
    }
  }

  async function handleScan(event: FormEvent) {
    event.preventDefault();
    if (!activeBagId) return toast.error("Create and select an open bag first.");
    if (!barcode.trim()) return;
    setScanning(true);
    try {
      const result = await scanOperationsParcel(manifestId, activeBagId, barcode, crypto.randomUUID());
      setData(result);
      setBarcode("");
      const latest = result.latestScan;
      if (latest?.message.includes("DPD label")) toast.info(latest.message);
      else toast.success(latest?.message || "Parcel added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This parcel could not be scanned.");
    } finally {
      setScanning(false);
    }
  }

  async function saveGoodsValue(consignmentId: string, current?: number | null) {
    const entered = window.prompt("Goods value in INR", current ? String(current / 100) : "");
    if (!entered) return;
    const rupees = Number(entered);
    if (!Number.isFinite(rupees) || rupees <= 0) return toast.error("Enter a valid goods value greater than zero.");
    await refreshAction(
      () => setOperationsGoodsValue(manifestId, consignmentId, Math.round(rupees * 100)),
      "Goods value updated."
    );
  }

  async function exportFile(format: "xlsx" | "pdf", view = false) {
    try { await downloadOperationsManifest(manifestId, format, view); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Export unavailable."); }
  }

  function requestReason(title: string, run: (reason: string) => Promise<unknown>) {
    setPendingReason({ title, run });
  }

  function requestParcelRemoval(parcelNumber: string) {
    const scan = currentData.scans.find((item) => item.parcelNumber === parcelNumber && item.status === "ACCEPTED");
    if (!scan) return toast.error("The active parcel scan could not be found. Refresh the manifest and try again.");
    requestReason(`Remove ${parcelNumber} from this bag`, (reason) => removeOperationsScan(manifestId, scan.id, reason));
  }

  return (
    <BusinessAccountsShell user={user}>
      <div className="mx-auto max-w-[1500px]">
        <ManifestHeader
          data={data}
          busy={busy}
          onRefresh={() => void load()}
          onExport={(format, view) => void exportFile(format, view)}
          onSeal={() => void refreshAction(() => runManifestAction(manifestId, "seal"), "Manifest sealed.")}
          onDispatch={() => void refreshAction(() => runManifestAction(manifestId, "dispatch"), "Manifest dispatched.")}
        />

        <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-[#EEEDED] bg-white shadow-sm md:grid-cols-4">
          <Metric label="Bags" value={manifest.totalBags} />
          <Metric label="Consignments" value={manifest.totalConsignments} />
          <Metric label="Parcels Scanned" value={manifest.totalPhysicalParcels} />
          <Metric label="Manifest Weight" value={`${manifest.totalWeightKg.toFixed(3)} kg`} />
        </div>

        {canEdit ? (
          <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-lg border border-[#EEEDED] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#EEEDED] bg-[#EEEDED]/70 px-4 py-3">
                <div><h2 className="font-semibold text-[#0D1282]">Bags</h2><p className="text-xs text-slate-500">Maximum 31 kg per bag.</p></div>
                <button onClick={() => void refreshAction(() => createOperationsBag(manifestId), "Bag created.")} title="Create bag" className="flex h-9 w-9 items-center justify-center rounded-md bg-[#0D1282] text-white hover:bg-[#0D1282]/90"><FiPlus /></button>
              </div>
              <div className="space-y-2 p-3">
                {data.bags.filter((bag) => bag.status !== "CANCELLED").map((bag) => (
                  <BagButton
                    key={bag.id}
                    bag={bag}
                    active={bag.id === activeBagId}
                    onSelect={() => setActiveBagId(bag.id)}
                    onAction={(action) => {
                      if (action === "close") return void refreshAction(() => runBagAction(manifestId, bag.id, "close"), "Bag closed.");
                      requestReason(`${action === "reopen" ? "Reopen" : "Cancel"} ${bag.bagNumber}`, (reason) => runBagAction(manifestId, bag.id, action, reason));
                    }}
                  />
                ))}
                {!data.bags.length ? <p className="p-4 text-center text-sm text-slate-500">Create the first bag to begin scanning.</p> : null}
              </div>
            </aside>

            <section className="overflow-hidden rounded-lg border border-[#EEEDED] bg-white shadow-sm">
              <div className="border-b border-[#EEEDED] p-5">
                <p className="text-xs font-semibold uppercase text-[#0D1282]">Active Bag</p>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-950">{activeBag?.bagNumber ?? "No bag selected"}</h2>
                  <span className="text-sm font-semibold text-slate-600">{activeBag?.totalWeightKg.toFixed(3) ?? "0.000"} / 31.000 kg</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EEEDED]"><div className="h-full rounded-full bg-[#F0DE36] transition-all" style={{ width: `${Math.min(100, ((activeBag?.totalWeightKg ?? 0) / 31) * 100)}%` }} /></div>
                <form onSubmit={handleScan} className="mt-4 flex gap-2">
                  <input ref={inputRef} value={barcode} onChange={(event) => setBarcode(event.target.value.toUpperCase())} disabled={!activeBag || !["OPEN", "REOPENED"].includes(activeBag.status) || scanning} placeholder="Scan Swiftline parcel barcode" className="h-12 min-w-0 flex-1 rounded-md border-2 border-[#0D1282] px-4 font-mono text-base font-semibold uppercase outline-none focus:ring-2 focus:ring-[#F0DE36]" />
                  <button disabled={scanning || !barcode.trim()} className="h-12 rounded-md bg-[#0D1282] px-6 text-sm font-semibold text-white hover:bg-[#0D1282]/90 disabled:opacity-50">{scanning ? "Adding..." : "Add Parcel"}</button>
                </form>
                <p className="mt-2 text-xs text-slate-500">Shipment details fill automatically. Bag weight increases only when each parcel is scanned.</p>
              </div>
              <ConsignmentTable rows={data.consignments.filter((item) => item.bagId === activeBagId)} canEdit onValue={saveGoodsValue} onRemove={requestParcelRemoval} />
            </section>
          </div>
        ) : <ConsignmentTable rows={data.consignments} canEdit={false} onValue={saveGoodsValue} onRemove={requestParcelRemoval} />}

        {data.sealingIssues.length && canEdit ? (
          <section className="mt-5 rounded-lg border border-[#F0DE36] bg-[#F0DE36]/15 p-5">
            <h2 className="font-semibold text-[#0D1282]">Before Sealing</h2>
            <ul className="mt-2 grid gap-1 text-sm text-slate-700 md:grid-cols-2">{data.sealingIssues.map((issue) => <li key={issue}>- {issue}</li>)}</ul>
          </section>
        ) : null}

        {canEdit ? <div className="mt-5 flex justify-end"><button onClick={() => requestReason("Cancel this manifest", (reason) => runManifestAction(manifestId, "cancel", reason))} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#D71313] bg-white px-4 text-sm font-semibold text-[#D71313] hover:bg-[#D71313]/5"><FiTrash2 />Cancel Manifest</button></div> : null}
      </div>

      {pendingReason ? (
        <ReasonDialog
          title={pendingReason.title}
          onClose={() => setPendingReason(null)}
          onConfirm={async (reason) => {
            await refreshAction(() => pendingReason.run(reason));
            setPendingReason(null);
          }}
        />
      ) : null}
    </BusinessAccountsShell>
  );
}

function ManifestHeader({ data, busy, onRefresh, onExport, onSeal, onDispatch }: { data: ManifestDetail; busy: boolean; onRefresh: () => void; onExport: (format: "xlsx" | "pdf", view?: boolean) => void; onSeal: () => void; onDispatch: () => void }) {
  const { manifest } = data;
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[#EEEDED] bg-white p-5 shadow-sm"><div><Link href="/dashboard/operations-manifests" className="text-sm font-semibold text-[#0D1282]">Back to manifests</Link><div className="mt-3 flex items-center gap-3"><h1 className="text-2xl font-semibold text-slate-950">{manifest.manifestNumber}</h1><span className="rounded border border-[#0D1282]/25 bg-[#EEEDED] px-2.5 py-1 text-xs font-semibold text-[#0D1282]">{manifest.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-sm text-slate-500">{manifest.branch?.name} ({manifest.branch?.code}) | {manifest.header.originIataCode || "Origin"} to {manifest.header.destinationIataCode || manifest.header.destinationCountryName || "Destination"}</p></div><div className="flex flex-wrap gap-2"><button onClick={onRefresh} title="Refresh" className="flex h-10 w-10 items-center justify-center rounded-md border border-[#0D1282]/20 bg-white text-[#0D1282] hover:bg-[#EEEDED]"><FiRefreshCw className={busy ? "animate-spin" : ""} /></button>{["SEALED", "DISPATCHED"].includes(manifest.status) ? <><ActionButton onClick={() => onExport("pdf", true)} icon={<FiPrinter />} label="View PDF" /><ActionButton onClick={() => onExport("xlsx")} icon={<FiDownload />} label="Excel" /><ActionButton onClick={() => onExport("pdf")} icon={<FiDownload />} label="PDF" /></> : null}{manifest.status === "READY_TO_SEAL" ? <button onClick={onSeal} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#F0DE36] px-4 text-sm font-semibold text-[#0D1282] hover:brightness-95"><FiCheck />Seal Manifest</button> : null}{manifest.status === "SEALED" ? <button onClick={onDispatch} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90"><FiSend />Dispatch</button> : null}</div></div>;
}

function ActionButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#0D1282]/20 bg-white px-4 text-sm font-semibold text-[#0D1282] hover:bg-[#EEEDED]">{icon}{label}</button>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="border-r border-[#EEEDED] p-4 last:border-r-0"><p className="text-xs font-semibold uppercase text-[#0D1282]">{label}</p><p className="mt-2 text-xl font-semibold text-slate-950">{value}</p></div>; }

function BagButton({ bag, active, onSelect, onAction }: { bag: OperationsBag; active: boolean; onSelect: () => void; onAction: (action: "close" | "reopen" | "cancel") => void }) {
  return <div className={`rounded-md border p-3 transition ${active ? "border-[#0D1282] bg-[#EEEDED]/70 shadow-sm" : "border-[#EEEDED] hover:border-[#0D1282]/30"}`}><button type="button" onClick={onSelect} className="w-full text-left"><div className="flex items-center justify-between"><span className="font-mono text-sm font-semibold text-[#0D1282]">{bag.bagNumber}</span><span className="rounded bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">{bag.status}</span></div><p className="mt-2 text-xs text-slate-500">{bag.totalConsignments} consignments | {bag.totalPhysicalParcels} parcels</p><p className="mt-1 text-sm font-semibold text-slate-800">{bag.totalWeightKg.toFixed(3)} / 31.000 kg</p></button><div className="mt-3 flex gap-2">{["OPEN", "REOPENED"].includes(bag.status) ? <button onClick={() => onAction("close")} className="h-8 flex-1 rounded border border-[#0D1282]/25 bg-white text-xs font-semibold text-[#0D1282]">Close</button> : <button onClick={() => onAction("reopen")} className="h-8 flex-1 rounded border border-[#0D1282]/25 bg-white text-xs font-semibold text-[#0D1282]">Reopen</button>}<button onClick={() => onAction("cancel")} className="h-8 rounded px-3 text-xs font-semibold text-[#D71313]">Cancel</button></div></div>;
}

function ConsignmentTable({ rows, canEdit, onValue, onRemove }: { rows: OperationsConsignment[]; canEdit: boolean; onValue: (id: string, current?: number | null) => void; onRemove: (parcel: string) => void }) {
  return <div className="overflow-x-auto rounded-lg border border-[#EEEDED] bg-white"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-[#0D1282] text-xs uppercase text-white"><tr><th className="px-4 py-3">Consignment</th><th className="px-4 py-3">Consignee</th><th className="px-4 py-3">Contents</th><th className="px-4 py-3">Scanned Parcels</th><th className="px-4 py-3 text-right">Weight</th><th className="px-4 py-3 text-right">Goods Value</th><th className="px-4 py-3">Notes</th></tr></thead><tbody className="divide-y divide-[#EEEDED]">{rows.map((item) => <tr key={item.id} className="align-top hover:bg-[#EEEDED]/35"><td className="px-4 py-4 font-mono font-semibold text-[#0D1282]">{item.displayConsignmentNumber || item.consignmentNumber}<p className="mt-1 text-xs font-normal text-slate-500">{item.serviceInfo} | {item.status}</p></td><td className="max-w-[240px] whitespace-pre-line px-4 py-4 text-xs leading-5">{item.consigneeSnapshot.formatted}</td><td className="max-w-[210px] px-4 py-4">{item.description}</td><td className="min-w-[260px] px-4 py-4"><p className={`mb-2 text-xs font-semibold ${item.status === "COMPLETE" ? "text-[#0D1282]" : "text-amber-700"}`}>{item.scannedParcelNumbers.length} of {item.expectedParcelNumbers.length} scanned</p><div className="space-y-2">{item.scannedParcelNumbers.map((parcel) => <div key={parcel} className="flex items-center justify-between gap-2 rounded border border-[#EEEDED] bg-white px-2 py-1.5"><span className="truncate font-mono text-[11px]">{parcel}</span>{canEdit ? <button type="button" onClick={() => onRemove(parcel)} title="Remove parcel from bag" className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-[#D71313] hover:bg-[#D71313]/5"><FiTrash2 />Remove</button> : null}</div>)}</div></td><td className="px-4 py-4 text-right font-semibold">{item.weightKg.toFixed(3)} kg</td><td className="px-4 py-4 text-right"><button disabled={!canEdit} onClick={() => onValue(item.id, item.declaredValueMinor)} className={`font-semibold ${item.goodsValueRequired ? "text-[#D71313] underline" : "text-[#0D1282]"}`}>{formatMoney(item.declaredValueMinor)}</button></td><td className="max-w-[220px] px-4 py-4 text-xs">{item.dpdWarning ? <span className="text-amber-700">{item.dpdWarning}</span> : <span className="text-[#0D1282]">DPD label available</span>}</td></tr>)}{!rows.length ? <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500"><FiArchive className="mx-auto mb-2 h-6 w-6 text-[#0D1282]" />No consignments in this bag.</td></tr> : null}</tbody></table></div>;
}

function ReasonDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (reason.trim().length < 5) return toast.error("Enter a clear reason of at least 5 characters."); setSaving(true); try { await onConfirm(reason.trim()); } finally { setSaving(false); } }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-lg border border-[#EEEDED] bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#EEEDED] px-5 py-4"><div><p className="text-xs font-semibold uppercase text-[#0D1282]">Correction Reason</p><h2 className="mt-1 font-semibold text-slate-950">{title}</h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-[#EEEDED]" title="Close"><FiX /></button></div><div className="p-5"><label className="text-xs font-semibold uppercase text-slate-600">Reason *<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Explain why this correction is required" className="mt-2 w-full resize-none rounded-md border border-slate-300 p-3 text-sm normal-case text-slate-950 outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#F0DE36]" /></label></div><div className="flex justify-end gap-2 border-t border-[#EEEDED] px-5 py-4"><button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="h-10 rounded-md bg-[#D71313] px-4 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Applying..." : "Confirm Correction"}</button></div></form></div>;
}
