"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { FiCamera, FiEdit3, FiExternalLink, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { loadClientPickupProof, loadDriverPickupProof, loadInternalPickupProof, type PickupAttempt } from "@/lib/pickups";

export default function PickupProofGallery({ pickupId, attempts, audience }: { pickupId: string; attempts: PickupAttempt[]; audience: "client" | "internal" | "driver" }) {
  const proofs = useMemo(() => attempts.flatMap((attempt) => (attempt.proofs ?? []).map((proof) => ({ ...proof, attemptId: attempt._id, attemptSequence: attempt.sequence }))), [attempts]);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [loadingId, setLoadingId] = useState("");

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  async function open(proof: (typeof proofs)[number]) {
    setLoadingId(proof.id);
    try {
      const url = audience === "client"
        ? await loadClientPickupProof(pickupId, proof.id)
        : audience === "driver"
          ? await loadDriverPickupProof(proof.attemptId, proof.id)
          : await loadInternalPickupProof(pickupId, proof.id);
      setPreview((current) => { if (current?.url) URL.revokeObjectURL(current.url); return { url, label: proof.type === "PHOTO" ? "Pickup photo" : "Customer signature" }; });
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Pickup proof could not be opened."); }
    finally { setLoadingId(""); }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div><h3 className="font-semibold text-slate-950">Proof of Pickup</h3><p className="mt-1 text-xs text-slate-500">Protected pickup photos and customer signatures.</p></div>
    {proofs.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{proofs.map((proof) => {
      const Icon = proof.type === "PHOTO" ? FiCamera : FiEdit3;
      return <button key={proof.id} type="button" disabled={loadingId === proof.id} onClick={() => void open(proof)} className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-[#0D1282] hover:bg-blue-50/40"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#0D1282]"><Icon /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{proof.type === "PHOTO" ? "Pickup photo" : "Customer signature"}</span><span className="block text-xs text-slate-500">Attempt {proof.attemptSequence} · {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(proof.capturedAt))}</span></span><FiExternalLink className="shrink-0 text-slate-400" /></button>;
    })}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No pickup proof has been captured yet.</p>}
    {preview ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={preview.label}><div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><strong>{preview.label}</strong><button type="button" onClick={() => setPreview(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"><FiX /></button></div><div className="relative min-h-[50vh] flex-1 bg-slate-100"><Image src={preview.url} alt={preview.label} fill unoptimized className="object-contain" /></div></div></div> : null}
  </section>;
}
