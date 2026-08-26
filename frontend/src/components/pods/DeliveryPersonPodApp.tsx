"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { FiArrowLeft, FiCamera, FiCheckCircle, FiClock, FiMapPin, FiPackage, FiRefreshCw, FiTruck } from "react-icons/fi";
import { toast } from "react-toastify";
import SignaturePad from "@/components/driver/SignaturePad";
import PodEvidenceGallery from "@/components/pods/PodEvidenceGallery";
import PodStatusBadge from "@/components/pods/PodStatusBadge";
import {
  getMyDelivery,
  listMyDeliveries,
  recordMyFailedDelivery,
  requestMySignatureException,
  saveMyPodDraft,
  submitMyPod,
  updateMyDeliveryStatus,
  uploadPodEvidence,
  type PodAssignment
} from "@/lib/pods";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

const emptyPod = {
  recipientName: "",
  recipientRelationship: "CONSIGNEE",
  deliveredAt: "",
  destinationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  notes: ""
};
const emptyFailed = { reason: "RECIPIENT_UNAVAILABLE", notes: "", nextActionAt: "" };

function podDraftSnapshot(pod: typeof emptyPod, parcels: string[]) {
  return JSON.stringify({ pod, parcels: [...parcels].sort() });
}

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Not scheduled";

const address = (value?: Record<string, string>) => value
  ? [value.addressLine1, value.addressLine2, value.townOrCity, value.county, value.postcode, value.countryName].filter(Boolean).join(", ")
  : "";

function localDateTime(value?: string) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

function correctionRevision(item: PodAssignment) {
  return item.revisions?.find((revision) => revision.status === "ACTION_REQUIRED") ?? null;
}

function editableRevision(item: PodAssignment) {
  return item.revisions?.find((revision) => revision.status === "DRAFT") ?? correctionRevision(item);
}

export default function DeliveryPersonPodApp() {
  const [rows, setRows] = useState<PodAssignment[]>([]);
  const [selected, setSelected] = useState<PodAssignment | null>(null);
  const [form, setForm] = useState(emptyPod);
  const [selectedParcels, setSelectedParcels] = useState<string[]>([]);
  const [savedPodSnapshot, setSavedPodSnapshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exception, setException] = useState("");
  const [failed, setFailed] = useState(emptyFailed);

  const persistableDirty = Boolean(savedPodSnapshot) && savedPodSnapshot !== podDraftSnapshot(form, selectedParcels);
  const localOnlyDirty = Boolean(exception.trim()) || JSON.stringify(failed) !== JSON.stringify(emptyFailed);
  const hasPodDraft = Boolean(selected) && !busy && (persistableDirty || localOnlyDirty);

  useUnsavedChanges(hasPodDraft, {
    label: "POD",
    // Exception and failed-attempt fields are submission actions, not part of
    // the POD draft endpoint. Do not offer a misleading Save Draft action when
    // those local-only fields are what would otherwise be lost.
    saveDraft: persistableDirty && !localOnlyDirty ? async () => {
      if (!selected) throw new Error("Open a delivery first.");
      await saveMyPodDraft(selected.id, {
        ...form,
        deliveredAt: new Date(form.deliveredAt).toISOString(),
        parcelNumbers: selectedParcels,
        partnerReference: selected.partnerReference,
        location: { captureStatus: "UNAVAILABLE" },
      });
      setSavedPodSnapshot(podDraftSnapshot(form, selectedParcels));
    } : undefined,
  });

  async function load() {
    setRows((await listMyDeliveries()).assignments);
  }

  useEffect(() => {
    let active = true;
    void listMyDeliveries()
      .then((result) => { if (active) setRows(result.assignments); })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Deliveries could not be loaded."));
    return () => { active = false; };
  }, []);

  function fillCorrectionForm(item: PodAssignment) {
    const revision = editableRevision(item);
    if (!revision) {
      setForm(emptyPod);
      setSelectedParcels([]);
      setSavedPodSnapshot(podDraftSnapshot(emptyPod, []));
      return;
    }
    const nextForm = {
      recipientName: revision.recipientName || "",
      recipientRelationship: revision.recipientRelationship || "CONSIGNEE",
      deliveredAt: localDateTime(revision.deliveredAt),
      destinationTimeZone: revision.destinationTimeZone || emptyPod.destinationTimeZone,
      notes: revision.notes || ""
    };
    const nextParcels = revision.parcelNumbers || [];
    setForm(nextForm);
    setSelectedParcels(nextParcels);
    setSavedPodSnapshot(podDraftSnapshot(nextForm, nextParcels));
  }

  async function open(id: string) {
    setBusy(true);
    try {
      const item = (await getMyDelivery(id)).assignment;
      setSelected(item);
      setException("");
      setFailed(emptyFailed);
      fillCorrectionForm(item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delivery could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(value: "ACCEPTED" | "OUT_FOR_DELIVERY") {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await updateMyDeliveryStatus(selected.id, value);
      setSelected(result.assignment);
      setSavedPodSnapshot(podDraftSnapshot(form, selectedParcels));
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>, type: "PHOTO" | "PARTNER_DOCUMENT") {
    const file = event.target.files?.[0];
    if (!selected || !file) return;
    setBusy(true);
    try {
      const result = await uploadPodEvidence(selected.id, type, file);
      setSelected(result.assignment);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evidence could not be uploaded.");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function uploadSignature(file: Blob) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await uploadPodEvidence(selected.id, "SIGNATURE", file);
      setSelected(result.assignment);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Signature could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function captureLocation() {
    return new Promise<Record<string, unknown>>((resolve) => {
      if (!navigator.geolocation) return resolve({ captureStatus: "UNAVAILABLE" });
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, captureStatus: "CAPTURED" }),
        (error) => resolve({ captureStatus: error.code === 1 ? "DENIED" : "UNAVAILABLE" }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
      );
    });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!selected) return null;
    setBusy(true);
    try {
      const result = await saveMyPodDraft(selected.id, {
        ...form,
        deliveredAt: new Date(form.deliveredAt).toISOString(),
        parcelNumbers: selectedParcels,
        partnerReference: selected.partnerReference,
        location: await captureLocation()
      });
      setSelected(result.assignment);
      setSavedPodSnapshot(podDraftSnapshot(form, selectedParcels));
      toast.success(result.message);
      return result.assignment;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "POD draft could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!selected) return;
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await submitMyPod(selected.id);
      setSelected(result.assignment);
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "POD could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  async function requestException() {
    if (!selected || exception.trim().length < 5) return;
    setBusy(true);
    try {
      const result = await requestMySignatureException(selected.id, exception);
      setSelected(result.assignment);
      setException("");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Exception could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function failDelivery(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const result = await recordMyFailedDelivery(selected.id, { ...failed, nextActionAt: new Date(failed.nextActionAt).toISOString() });
      setSelected(result.assignment);
      setFailed(emptyFailed);
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed attempt could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold">My deliveries</h1><p className="text-sm text-slate-500">Assigned international last-mile work.</p></div>
        <button type="button" onClick={() => void load()} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm"><FiRefreshCw /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((item) => {
          const correction = item.latestPodStatus === "ACTION_REQUIRED";
          return <button key={item.id} type="button" onClick={() => void open(item.id)} className="rounded-3xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-2"><strong>{item.partnerReference}</strong><div className="flex gap-2">{correction ? <PodStatusBadge status="ACTION_REQUIRED" /> : null}<PodStatusBadge status={item.status} /></div></div>
            <p className="mt-3 flex gap-2 text-sm text-slate-600"><FiClock />{formatDate(item.expectedDeliveryAt)}</p>
            <p className="mt-2 text-xs font-semibold text-slate-500">{item.parcelNumbers.length} parcels</p>
          </button>;
        })}
      </div>
      {!rows.length ? <div className="rounded-3xl bg-white p-10 text-center"><FiTruck className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-semibold">No assigned deliveries</p></div> : null}
    </div>;
  }

  const destination = selected.shipment?.consigneeValidatedAddress || selected.shipment?.consigneeSelectedAddress || selected.shipment?.consigneeEnteredAddress;
  const latest = selected.revisions?.[0] ?? null;
  const correction = correctionRevision(selected);
  const correctionInProgress = latest?.status === "DRAFT" && Boolean(correction);
  const needsCorrection = latest?.status === "ACTION_REQUIRED" || correctionInProgress;
  const editable = needsCorrection || ["OUT_FOR_DELIVERY", "DELIVERY_FAILED", "PARTIALLY_DELIVERED"].includes(selected.status);
  const parcelChoices = needsCorrection
    ? (editableRevision(selected)?.parcelNumbers ?? correction?.parcelNumbers ?? selected.parcelNumbers)
    : selected.parcelNumbers.filter((parcel) => !selected.deliveredParcelNumbers.includes(parcel));

  return <div className="space-y-4">
    <button type="button" onClick={() => setSelected(null)} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold shadow"><FiArrowLeft />My deliveries</button>

    <section className="overflow-hidden rounded-3xl bg-white shadow-sm">
      <div className="bg-[#0D1282] p-5 text-white">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-blue-100">International delivery</p><h1 className="mt-1 text-xl font-bold">{selected.booking?.swiftlineTrackingNumber || selected.partnerReference}</h1></div><PodStatusBadge status={selected.status} /></div>
      </div>
      <div className="space-y-3 p-4"><p className="flex items-start gap-2 text-sm"><FiMapPin className="mt-0.5 shrink-0 text-[#0D1282]" />{address(destination)}</p><p className="flex gap-2 text-sm"><FiPackage className="text-[#0D1282]" />{selected.parcelNumbers.join(", ")}</p>{selected.shipment?.consigneeEnteredAddress.contactName ? <p className="text-sm"><strong>Consignee:</strong> {selected.shipment.consigneeEnteredAddress.contactName}</p> : null}</div>
    </section>

    {needsCorrection && correction ? <section className="rounded-3xl border border-red-300 bg-red-50 p-4 text-red-900"><div className="flex items-center gap-2"><PodStatusBadge status="ACTION_REQUIRED" /><strong>POD correction required</strong></div><p className="mt-2 text-sm">{correction.reviewReason}</p><p className="mt-2 text-xs">Update the requested information or evidence and resubmit it for review.</p></section> : null}
    {selected.status === "ASSIGNED" ? <button disabled={busy} type="button" onClick={() => void changeStatus("ACCEPTED")} className="h-14 w-full rounded-2xl bg-[#F0DE36] font-bold text-[#0D1282]">Accept delivery</button> : null}
    {selected.status === "ACCEPTED" ? <button disabled={busy} type="button" onClick={() => void changeStatus("OUT_FOR_DELIVERY")} className="h-14 w-full rounded-2xl bg-[#F0DE36] font-bold text-[#0D1282]">Start delivery</button> : null}

    {editable ? <>
      <form onSubmit={(event) => void save(event)} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
        <div><h2 className="font-bold">{needsCorrection ? "Correct POD details" : "Delivered parcels"}</h2><p className="text-xs text-slate-500">Only parcels from this shipment can be selected.</p></div>
        <div className="grid gap-2">{parcelChoices.map((parcel) => <label key={parcel} className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm font-semibold"><input type="checkbox" checked={selectedParcels.includes(parcel)} onChange={(event) => setSelectedParcels((value) => event.target.checked ? [...new Set([...value, parcel])] : value.filter((item) => item !== parcel))} />{parcel}</label>)}</div>
        <input required placeholder="Recipient full name" value={form.recipientName} onChange={(event) => setForm((value) => ({ ...value, recipientName: event.target.value }))} className="h-12 w-full rounded-xl border px-3" />
        <select value={form.recipientRelationship} onChange={(event) => setForm((value) => ({ ...value, recipientRelationship: event.target.value }))} className="h-12 w-full rounded-xl border px-3"><option value="CONSIGNEE">Consignee</option><option value="FAMILY_MEMBER">Family member</option><option value="RECEPTION">Reception</option><option value="SECURITY">Security</option><option value="EMPLOYEE">Employee</option><option value="NEIGHBOUR">Neighbour</option><option value="OTHER">Other</option></select>
        <label className="block text-xs font-semibold text-slate-500">Local delivery date and time<input required type="datetime-local" value={form.deliveredAt} onChange={(event) => setForm((value) => ({ ...value, deliveredAt: event.target.value }))} className="mt-1 h-12 w-full rounded-xl border px-3 text-sm text-slate-900" /></label>
        <input required value={form.destinationTimeZone} onChange={(event) => setForm((value) => ({ ...value, destinationTimeZone: event.target.value }))} placeholder="Time zone, e.g. Europe/London" className="h-12 w-full rounded-xl border px-3" />
        <textarea value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} placeholder="Delivery notes" className="min-h-24 w-full rounded-xl border p-3" />
        <button disabled={busy || !selectedParcels.length} className="h-12 w-full rounded-xl border border-[#0D1282] font-semibold text-[#0D1282]">Save {needsCorrection ? "correction" : "draft"}</button>
      </form>

      <section className="rounded-3xl bg-white p-4 shadow-sm"><h2 className="font-bold">Required delivery photo</h2><label className="mt-3 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#0D1282] font-semibold text-[#0D1282]"><FiCamera />Take or upload photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void upload(event, "PHOTO")} className="sr-only" /></label></section>
      <section className="rounded-3xl bg-white p-4 shadow-sm"><h2 className="font-bold">Required recipient signature</h2><SignaturePad disabled={busy} onSave={uploadSignature} /><details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-amber-800">Recipient cannot sign</summary><textarea value={exception} onChange={(event) => setException(event.target.value)} placeholder="Explain why a signature is impossible" className="mt-3 min-h-24 w-full rounded-xl border border-amber-300 p-3" /><button type="button" onClick={() => void requestException()} className="mt-2 h-11 w-full rounded-xl bg-amber-400 font-bold">Request supervisor exception</button></details></section>
      {latest ? <section className="rounded-3xl bg-white p-4 shadow-sm"><div className="mb-3 flex justify-between"><h2 className="font-bold">Captured evidence · revision {latest.revisionNumber}</h2><PodStatusBadge status={latest.status} /></div><PodEvidenceGallery assignmentId={selected.id} revision={latest} audience="delivery" /></section> : null}
      <button disabled={busy || !selectedParcels.length} type="button" onClick={() => void submit()} className="h-14 w-full rounded-2xl bg-emerald-600 font-bold text-white disabled:bg-slate-300"><FiCheckCircle className="mr-2 inline" />{needsCorrection ? "Resubmit corrected POD" : "Submit POD for verification"}</button>

      {!needsCorrection ? <details className="rounded-3xl border border-red-200 bg-white p-4"><summary className="cursor-pointer font-bold text-red-700">Record failed delivery</summary><form onSubmit={failDelivery} className="mt-4 space-y-3"><p className="text-xs text-slate-500">Upload a delivery photo above before recording failure.</p><select value={failed.reason} onChange={(event) => setFailed((value) => ({ ...value, reason: event.target.value }))} className="h-12 w-full rounded-xl border px-3"><option value="RECIPIENT_UNAVAILABLE">Recipient unavailable</option><option value="RECIPIENT_REFUSED">Recipient refused</option><option value="INCORRECT_ADDRESS">Incorrect address</option><option value="ADDRESS_NOT_FOUND">Address not found</option><option value="BUSINESS_CLOSED">Business closed</option><option value="CUSTOMS_HOLD">Customs hold</option><option value="PAYMENT_OR_DUTY_PENDING">Payment or duty pending</option><option value="DAMAGED_SHIPMENT">Damaged shipment</option><option value="MISSING_PARCEL">Missing parcel</option><option value="UNSAFE_LOCATION">Unsafe location</option><option value="FORCE_MAJEURE">Force majeure</option><option value="OTHER">Other</option></select><textarea required minLength={3} value={failed.notes} onChange={(event) => setFailed((value) => ({ ...value, notes: event.target.value }))} placeholder="Attempt notes" className="min-h-24 w-full rounded-xl border p-3" /><input required type="datetime-local" value={failed.nextActionAt} onChange={(event) => setFailed((value) => ({ ...value, nextActionAt: event.target.value }))} className="h-12 w-full rounded-xl border px-3" /><button className="h-12 w-full rounded-xl bg-red-600 font-semibold text-white">Save failed attempt</button></form></details> : null}
    </> : null}

    {selected.status === "DELIVERED" && !needsCorrection ? <div className="rounded-3xl bg-emerald-50 p-6 text-center text-emerald-800"><FiCheckCircle className="mx-auto h-9 w-9" /><h2 className="mt-2 font-bold">Delivery completed</h2><p className="text-sm">POD is awaiting or has completed Swiftline verification.</p></div> : null}
  </div>;
}
