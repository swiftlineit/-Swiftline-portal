"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import { countryOptions } from "@/lib/branches";
import { createOperationsManifest, listManifestBranches, type ManifestHeader } from "@/lib/operationsManifests";
import { useAdminUser } from "@/lib/useAdminUser";

const emptyHeader: ManifestHeader = { destinationAgent: "", destinationCountryCode: "", destinationCountryName: "", flightNumber: "", departureDate: "", mawbNumber: "", originIataCode: "", destinationIataCode: "", valueType: "LV" };

export default function NewOperationsManifestPage() {
  const { user, loading } = useAdminUser(true); const router = useRouter();
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]); const [branchId, setBranchId] = useState(""); const [header, setHeader] = useState(emptyHeader); const [saving, setSaving] = useState(false);
  useEffect(() => { if (user) void listManifestBranches().then((data) => setBranches(data.branches)).catch((error) => toast.error(error.message)); }, [user]);
  if (loading || !user) return <BusinessAccountsLoading />;
  const field = (key: keyof ManifestHeader, value: string) => setHeader((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!branchId) return toast.error("Select the origin branch."); setSaving(true); try { const result = await createOperationsManifest({ branchId, header }); toast.success(`${result.manifestNumber} created.`); router.push(`/dashboard/operations-manifests/${result.manifestId}`); } catch (error) { toast.error(error instanceof Error ? error.message : "Manifest could not be created."); } finally { setSaving(false); } }
  const controlClass = "mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm normal-case text-slate-950 outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#F0DE36]";
  return <BusinessAccountsShell user={user}><form onSubmit={submit} className="mx-auto max-w-5xl"><div className="mb-6 rounded-lg border border-[#EEEDED] bg-white p-5 shadow-sm"><Link href="/dashboard/operations-manifests" className="text-sm font-semibold text-[#0D1282]">Back to manifests</Link><h1 className="mt-4 text-2xl font-semibold text-[#0D1282]">Create Operations Manifest</h1><p className="mt-1 text-sm text-slate-500">Set the branch and flight route. Bags and shipments are added in the scanner workspace.</p></div>
    <section className="overflow-hidden rounded-lg border border-[#EEEDED] bg-white shadow-sm"><div className="border-b border-[#EEEDED] bg-[#EEEDED]/70 px-6 py-4"><h2 className="font-semibold text-[#0D1282]">Route And Flight</h2></div><div className="grid gap-5 p-6 md:grid-cols-2">
      <label className="text-xs font-semibold uppercase text-slate-600">Origin Branch *<select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${controlClass} pr-10`}><option value="">Select branch</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>
      <label className="text-xs font-semibold uppercase text-slate-600">Destination Country *<select value={header.destinationCountryCode} onChange={(e) => { const country = countryOptions.find((item) => item.code === e.target.value); field("destinationCountryCode", e.target.value); field("destinationCountryName", country?.name ?? ""); }} className={`${controlClass} pr-10`}><option value="">Select country</option>{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase text-slate-600 md:col-span-2">Destination Agent Details *<textarea value={header.destinationAgent} onChange={(e) => field("destinationAgent", e.target.value)} rows={4} placeholder="Agent name, company, complete address and contact details" className="mt-2 w-full resize-y rounded-md border border-slate-300 p-3 text-sm normal-case text-slate-950 outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#F0DE36]" /></label>
      {[{ key: "flightNumber", label: "Flight Number", placeholder: "EY-219" }, { key: "departureDate", label: "Departure Date", type: "date" }, { key: "mawbNumber", label: "MAWB Number", placeholder: "607-54691055" }, { key: "valueType", label: "Value Type", placeholder: "LV" }, { key: "originIataCode", label: "Origin IATA", placeholder: "DEL" }, { key: "destinationIataCode", label: "Destination IATA", placeholder: "LHR" }].map((item) => <label key={item.key} className="text-xs font-semibold uppercase text-slate-600">{item.label} *<input type={item.type ?? "text"} value={header[item.key as keyof ManifestHeader]} onChange={(e) => field(item.key as keyof ManifestHeader, e.target.value.toUpperCase())} placeholder={item.placeholder} maxLength={item.key.includes("Iata") ? 3 : undefined} className={controlClass} /></label>)}
    </div></section><div className="mt-5 flex justify-end gap-3"><Link href="/dashboard/operations-manifests" className="inline-flex h-11 items-center rounded-md border border-[#0D1282]/20 bg-white px-5 text-sm font-semibold text-[#0D1282]">Cancel</Link><button disabled={saving} className="h-11 rounded-md bg-[#0D1282] px-6 text-sm font-semibold text-white hover:bg-[#0D1282]/90 disabled:opacity-60">{saving ? "Creating..." : "Create Manifest"}</button></div>
  </form></BusinessAccountsShell>;
}
