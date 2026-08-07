"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { FiFileText, FiImage, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { loadPodEvidence, type PodRevision } from "@/lib/pods";

export default function PodEvidenceGallery({ assignmentId, revision, audience }: { assignmentId: string; revision: PodRevision; audience: "manager" | "delivery" | "client" }) {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  async function open(id: string, mime: string, name: string) { try { const file = await loadPodEvidence(assignmentId, revision.id, id, audience); const url = URL.createObjectURL(file); if (mime === "application/pdf") { window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); } else setPreview({ url, mime, name }); } catch (error) { toast.error(error instanceof Error ? error.message : "Evidence could not be opened."); } }
  return <><div className="grid gap-2 sm:grid-cols-2">{revision.evidence.map((item) => <button key={item.id} type="button" onClick={() => void open(item.id, item.mimeType, item.originalName)} className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-[#0D1282]"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-[#0D1282]">{item.mimeType === "application/pdf" ? <FiFileText /> : <FiImage />}</span><span className="min-w-0"><strong className="block text-xs">{item.type.replace(/_/g, " ")}</strong><span className="block truncate text-[11px] text-slate-500">{item.originalName}</span></span></button>)}</div>{preview ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4"><button onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900"><FiX /></button><Image src={preview.url} alt={preview.name} width={1400} height={1000} unoptimized className="max-h-[88vh] w-auto max-w-full rounded-xl object-contain" /></div> : null}</>;
}
