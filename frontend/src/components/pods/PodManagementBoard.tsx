"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FiCheckCircle, FiFileText, FiPlus, FiRefreshCw, FiTruck, FiXCircle } from "react-icons/fi";
import { toast } from "react-toastify";
import PodEvidenceGallery from "@/components/pods/PodEvidenceGallery";
import PodStatusBadge from "@/components/pods/PodStatusBadge";
import {
  createPodAssignment,
  createPodPartner,
  getManagedPod,
  listDeliveryPeople,
  listManagedPods,
  listPodEligibleShipments,
  listPodPartners,
  reassignPod,
  reviewPod,
  reviewSignatureException,
  submitManagedPod,
  uploadPodEvidence,
  type DeliveryPartner,
  type DeliveryPersonOption,
  type EligiblePodShipment,
  type PodAssignment
} from "@/lib/pods";

const emptyAssignment = { shipmentDraftId: "", deliveryPersonProfileId: "", deliveryPartnerId: "", partnerReference: "", expectedDeliveryAt: "" };
const emptyPartner = { name: "", code: "", countries: "", contactName: "", email: "", phone: "", contractReference: "", podSlaHours: 48 };
const emptyManual = { recipientName: "", recipientRelationship: "CONSIGNEE", deliveredAt: "", destinationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", notes: "", manualSourceNote: "", originalReceivedAt: "" };

const personName = (person?: DeliveryPersonOption) => person?.user?.name || `${person?.user?.firstName ?? ""} ${person?.user?.lastName ?? ""}`.trim();
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not scheduled";

function scrollWorkspaceToTop() {
  const workspace = document.querySelector<HTMLElement>("[data-dashboard-scroll]");
  workspace?.scrollTo({ top: 0, behavior: "auto" });
  document.querySelector<HTMLElement>("[data-dashboard-sidebar-scroll]")?.scrollTo({ top: 0, behavior: "auto" });
}

export default function PodManagementBoard({ operationsControls = false }: { operationsControls?: boolean }) {
  const [assignments, setAssignments] = useState<PodAssignment[]>([]);
  const [shipments, setShipments] = useState<EligiblePodShipment[]>([]);
  const [people, setPeople] = useState<DeliveryPersonOption[]>([]);
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [selected, setSelected] = useState<PodAssignment | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showPartner, setShowPartner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [partnerError, setPartnerError] = useState("");
  const [assignment, setAssignment] = useState(emptyAssignment);
  const [partner, setPartner] = useState(emptyPartner);
  const [reassignment, setReassignment] = useState({ deliveryPersonProfileId: "", reason: "" });
  const [manual, setManual] = useState(emptyManual);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    const [assignmentData, shipmentData, peopleData, partnerData] = await Promise.all([
      listManagedPods(), listPodEligibleShipments(), listDeliveryPeople(), listPodPartners()
    ]);
    setAssignments(assignmentData.assignments);
    setShipments(shipmentData.shipments);
    setPeople(peopleData.deliveryPeople);
    setPartners(partnerData.partners);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([listManagedPods(), listPodEligibleShipments(), listDeliveryPeople(), listPodPartners()])
      .then(([assignmentData, shipmentData, peopleData, partnerData]) => {
        if (!active) return;
        setAssignments(assignmentData.assignments);
        setShipments(shipmentData.shipments);
        setPeople(peopleData.deliveryPeople);
        setPartners(partnerData.partners);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "POD work could not be loaded."));
    return () => { active = false; };
  }, []);

  async function refreshOptions() {
    setOptionsLoading(true);
    try {
      const [shipmentData, peopleData, partnerData] = await Promise.all([
        listPodEligibleShipments(), listDeliveryPeople(), listPodPartners()
      ]);
      setShipments(shipmentData.shipments);
      setPeople(peopleData.deliveryPeople);
      setPartners(partnerData.partners);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Assignment options could not be refreshed.");
    } finally {
      setOptionsLoading(false);
    }
  }

  async function openAssignModal() {
    await refreshOptions();
    setShowAssign(true);
  }

  async function open(id: string) {
    setBusy(true);
    try {
      setSelected((await getManagedPod(id)).assignment);
      setReason("");
      setReasonError("");
      requestAnimationFrame(scrollWorkspaceToTop);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Assignment could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  const selectedShipment = useMemo(
    () => shipments.find((item) => item.id === assignment.shipmentDraftId),
    [shipments, assignment.shipmentDraftId]
  );

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!selectedShipment) return;
    setBusy(true);
    try {
      const result = await createPodAssignment({
        ...assignment,
        deliveryPartnerId: assignment.deliveryPartnerId || null,
        expectedDeliveryAt: assignment.expectedDeliveryAt ? new Date(assignment.expectedDeliveryAt).toISOString() : null,
        parcelNumbers: selectedShipment.parcelNumbers
      });
      toast.success(result.message);
      setShowAssign(false);
      setAssignment(emptyAssignment);
      await load();
      setSelected(result.assignment);
      requestAnimationFrame(scrollWorkspaceToTop);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delivery could not be assigned.");
    } finally {
      setBusy(false);
    }
  }

  async function addPartner(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPartnerError("");
    try {
      const result = await createPodPartner({
        ...partner,
        countries: partner.countries.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean)
      });
      setPartners((current) => [...current.filter((item) => item._id !== result.partner._id), result.partner].sort((a, b) => a.name.localeCompare(b.name)));
      setPartner(emptyPartner);
      setShowPartner(false);
      toast.success(`${result.partner.name} was added successfully.`);
      requestAnimationFrame(scrollWorkspaceToTop);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Partner could not be created.";
      setPartnerError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function review(approved: boolean) {
    if (!selected) return;
    if (!approved && reason.trim().length < 3) {
      setReasonError("Enter the correction reason before returning this POD.");
      reasonRef.current?.focus();
      reasonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setReasonError("");
    try {
      const result = await reviewPod(selected.id, approved, reason);
      setSelected(result.assignment);
      setReason("");
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "POD could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  async function signatureException(approved: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await reviewSignatureException(selected.id, approved, reason);
      setSelected(result.assignment);
      setReason("");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Exception could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>, type: "PHOTO" | "SIGNATURE" | "PARTNER_DOCUMENT") {
    const file = event.target.files?.[0];
    if (!selected || !file) return;
    setBusy(true);
    try {
      const result = await uploadPodEvidence(selected.id, type, file, "manager");
      setSelected(result.assignment);
      toast.success("Partner evidence uploaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evidence could not be uploaded.");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function reassign(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const result = await reassignPod(selected.id, reassignment.deliveryPersonProfileId, reassignment.reason);
      setSelected(result.assignment);
      setReassignment({ deliveryPersonProfileId: "", reason: "" });
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delivery could not be reassigned.");
    } finally {
      setBusy(false);
    }
  }

  async function manualSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const result = await submitManagedPod(selected.id, {
        ...manual,
        deliveredAt: new Date(manual.deliveredAt).toISOString(),
        originalReceivedAt: new Date(manual.originalReceivedAt).toISOString(),
        parcelNumbers: selected.parcelNumbers.filter((item) => !selected.deliveredParcelNumbers.includes(item)),
        partnerReference: selected.partnerReference,
        location: { captureStatus: "UNAVAILABLE" }
      });
      setSelected(result.assignment);
      setManual(emptyManual);
      toast.success(result.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Partner POD could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const person = selected.currentDeliveryPersonProfileId?.userId;
    return <div className="min-h-full space-y-4 pb-8">
      <button type="button" onClick={() => { setSelected(null); requestAnimationFrame(scrollWorkspaceToTop); }} className="h-10 rounded-full border bg-white px-4 text-sm font-semibold">← POD queue</button>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">{selected.booking?.swiftlineTrackingNumber || "International delivery"}</p><h1 className="mt-1 text-xl font-bold">{selected.partnerReference}</h1></div><PodStatusBadge status={selected.status} /></div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><p><span className="text-slate-500">Delivery person</span><br /><strong>{person?.name || `${person?.firstName ?? ""} ${person?.lastName ?? ""}` || "Not assigned"}</strong></p><p><span className="text-slate-500">Partner</span><br /><strong>{selected.deliveryPartnerId?.name || "Swiftline / contractor"}</strong></p><p><span className="text-slate-500">Expected</span><br /><strong>{formatDate(selected.expectedDeliveryAt)}</strong></p><p className="break-words"><span className="text-slate-500">Parcels</span><br /><strong>{selected.parcelNumbers.join(", ")}</strong></p></div>
        {!['DELIVERED', 'CANCELLED', 'RETURNED'].includes(selected.status) ? <form onSubmit={reassign} className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]"><select required value={reassignment.deliveryPersonProfileId} onChange={(event) => setReassignment((value) => ({ ...value, deliveryPersonProfileId: event.target.value }))} className="h-11 rounded-xl border px-3"><option value="">Reassign to…</option>{people.map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}</select><input required minLength={3} value={reassignment.reason} onChange={(event) => setReassignment((value) => ({ ...value, reason: event.target.value }))} placeholder="Reason for reassignment" className="h-11 rounded-xl border px-3" /><button className="h-11 rounded-xl border border-[#0D1282] px-4 text-sm font-semibold text-[#0D1282]">Reassign</button></form> : null}
      </section>

      {selected.disputes?.length ? <section className="rounded-3xl border border-red-200 bg-red-50 p-4"><h2 className="font-bold text-red-800">Client-reported POD issues</h2>{selected.disputes.map((item) => <div key={item._id} className="mt-3 rounded-xl bg-white p-3 text-sm"><div className="flex justify-between"><strong>{item.category.replace(/_/g, " ")}</strong><PodStatusBadge status={item.status} /></div><p className="mt-1 text-slate-600">{item.details}</p></div>)}</section> : null}

      {selected.revisions?.map((revision, index) => <section key={revision.id} className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex justify-between gap-3"><div><h2 className="font-bold">POD revision {revision.revisionNumber}</h2><p className="text-xs text-slate-500">Immutable submission history</p></div><PodStatusBadge status={revision.status} /></div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><p>Recipient: <strong>{revision.recipientName || "Pending"}</strong></p><p>Relationship: <strong>{revision.recipientRelationship?.replace(/_/g, " ")}</strong></p><p>Delivered: <strong>{formatDate(revision.deliveredAt)}</strong></p><p className="break-words">Parcels: <strong>{revision.parcelNumbers?.join(", ") || "Pending"}</strong></p></div>
        <div className="mt-4"><PodEvidenceGallery assignmentId={selected.id} revision={revision} audience="manager" /></div>
        {revision.reviewReason ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"><strong>Review reason:</strong> {revision.reviewReason}</p> : null}
        {index === 0 && revision.signatureExceptionStatus === "PENDING" ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><strong>Signature exception requested</strong><p className="mt-1 text-sm">{revision.signatureExceptionReason}</p><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Review note" className="mt-3 min-h-20 w-full rounded-xl border p-3" /><div className="mt-2 flex gap-2"><button type="button" onClick={() => void signatureException(true)} className="h-10 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white">Approve</button><button type="button" onClick={() => void signatureException(false)} className="h-10 rounded-full bg-red-600 px-4 text-sm font-semibold text-white">Reject</button></div></div> : null}
        {index === 0 && ["SUBMITTED", "UNDER_REVIEW"].includes(revision.status) ? <div className="mt-4 border-t pt-4"><label className="block text-sm font-semibold text-slate-700">Correction reason<textarea ref={reasonRef} value={reason} onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(""); }} aria-invalid={Boolean(reasonError)} placeholder="Required when returning POD for correction" className={`mt-2 min-h-24 w-full rounded-xl border p-3 outline-none transition ${reasonError ? "border-red-500 bg-red-50 ring-2 ring-red-200" : "border-slate-300 focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"}`} /></label>{reasonError ? <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{reasonError}</p> : null}<div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} type="button" onClick={() => void review(true)} className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-600 px-5 font-semibold text-white"><FiCheckCircle />Verify POD</button><button disabled={busy} type="button" onClick={() => void review(false)} className="inline-flex h-11 items-center gap-2 rounded-full bg-red-600 px-5 font-semibold text-white"><FiXCircle />Return for correction</button></div></div> : null}
      </section>)}

      {operationsControls ? <section className="rounded-3xl bg-white p-5 shadow-sm"><h2 className="font-bold">Operations upload fallback</h2><p className="mt-1 text-xs text-slate-500">Upload the required photo and signature received from the partner, then record its original source and delivery details.</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{(["PARTNER_DOCUMENT", "PHOTO", "SIGNATURE"] as const).map((type) => <label key={type} className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#0D1282] text-xs font-semibold text-[#0D1282]"><FiFileText />{type.replace(/_/g, " ")}<input type="file" accept={type === "PARTNER_DOCUMENT" ? "application/pdf,image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp"} onChange={(event) => void uploadEvidence(event, type)} className="sr-only" /></label>)}</div><form onSubmit={manualSubmit} className="mt-4 grid gap-3 sm:grid-cols-2"><input required value={manual.recipientName} onChange={(event) => setManual((value) => ({ ...value, recipientName: event.target.value }))} placeholder="Recipient full name" className="h-11 rounded-xl border px-3" /><select value={manual.recipientRelationship} onChange={(event) => setManual((value) => ({ ...value, recipientRelationship: event.target.value }))} className="h-11 rounded-xl border px-3"><option value="CONSIGNEE">Consignee</option><option value="FAMILY_MEMBER">Family member</option><option value="RECEPTION">Reception</option><option value="SECURITY">Security</option><option value="EMPLOYEE">Employee</option><option value="NEIGHBOUR">Neighbour</option><option value="OTHER">Other</option></select><label className="text-xs text-slate-500">Delivered locally<input required type="datetime-local" value={manual.deliveredAt} onChange={(event) => setManual((value) => ({ ...value, deliveredAt: event.target.value }))} className="mt-1 h-11 w-full rounded-xl border px-3 text-slate-900" /></label><label className="text-xs text-slate-500">Originally received<input required type="datetime-local" value={manual.originalReceivedAt} onChange={(event) => setManual((value) => ({ ...value, originalReceivedAt: event.target.value }))} className="mt-1 h-11 w-full rounded-xl border px-3 text-slate-900" /></label><input required value={manual.destinationTimeZone} onChange={(event) => setManual((value) => ({ ...value, destinationTimeZone: event.target.value }))} placeholder="Destination time zone" className="h-11 rounded-xl border px-3" /><input required minLength={3} value={manual.manualSourceNote} onChange={(event) => setManual((value) => ({ ...value, manualSourceNote: event.target.value }))} placeholder="Source, e.g. received by email from partner" className="h-11 rounded-xl border px-3" /><textarea value={manual.notes} onChange={(event) => setManual((value) => ({ ...value, notes: event.target.value }))} placeholder="Delivery notes" className="min-h-20 rounded-xl border p-3 sm:col-span-2" /><button disabled={busy} className="h-11 rounded-xl bg-[#0D1282] font-semibold text-white sm:col-span-2">Submit partner POD for independent review</button></form></section> : null}
    </div>;
  }

  return <div className="min-h-full space-y-5 pb-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">International POD</h1><p className="text-sm text-slate-500">Assign last-mile work and verify delivery evidence.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} aria-label="Refresh POD queue" className="flex h-10 w-10 items-center justify-center rounded-full border bg-white"><FiRefreshCw /></button>{operationsControls ? <button type="button" onClick={() => { setPartnerError(""); setShowPartner(true); }} className="h-10 rounded-full border border-[#0D1282] px-4 text-sm font-semibold text-[#0D1282]">Add partner</button> : null}<button type="button" onClick={() => void openAssignModal()} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0D1282] px-4 text-sm font-semibold text-white"><FiPlus />Assign delivery</button></div></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{assignments.map((item) => <button key={item.id} type="button" onClick={() => void open(item.id)} className="rounded-2xl border bg-white p-4 text-left shadow-sm"><div className="flex justify-between gap-2"><strong>{item.partnerReference}</strong><PodStatusBadge status={item.status} /></div><p className="mt-3 text-sm text-slate-600">{item.deliveryPartnerId?.name || "Swiftline / contractor"}</p><p className="mt-2 text-xs text-slate-500">{item.parcelNumbers.length} parcels · {formatDate(item.expectedDeliveryAt)}</p></button>)}</div>
    {!assignments.length ? <div className="rounded-3xl border border-dashed p-10 text-center text-slate-500"><FiTruck className="mx-auto h-8 w-8" /><p className="mt-2">No international delivery assignments.</p></div> : null}

    {showAssign ? <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/50 sm:items-center sm:p-4"><form onSubmit={assign} className="my-auto w-full max-w-xl rounded-t-3xl bg-white p-5 sm:rounded-3xl"><h2 className="text-xl font-bold">Assign international delivery</h2><div className="mt-4 space-y-3"><select required disabled={optionsLoading} value={assignment.shipmentDraftId} onChange={(event) => setAssignment((value) => ({ ...value, shipmentDraftId: event.target.value }))} className="h-12 w-full rounded-xl border px-3"><option value="">{optionsLoading ? "Refreshing shipments…" : "Select eligible shipment"}</option>{shipments.map((item) => <option key={item.id} value={item.id}>{item.trackingNumber} · {item.consignee.countryCode} · {item.parcelCount} parcels</option>)}</select><select required disabled={optionsLoading || !people.length} value={assignment.deliveryPersonProfileId} onChange={(event) => setAssignment((value) => ({ ...value, deliveryPersonProfileId: event.target.value }))} className="h-12 w-full rounded-xl border px-3"><option value="">{optionsLoading ? "Refreshing delivery people…" : people.length ? "Select delivery person" : "No active delivery people available"}</option>{people.map((item) => <option key={item.id} value={item.id}>{personName(item)}{item.user?.phone ? ` · ${item.user.phone}` : ""}{item.deliveryPartnerId ? ` · ${item.deliveryPartnerId.name}` : ""}</option>)}</select>{!people.length && !optionsLoading ? <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Create an international delivery person, activate their invitation, and approve their profile before assigning work.</p> : null}<select value={assignment.deliveryPartnerId} onChange={(event) => setAssignment((value) => ({ ...value, deliveryPartnerId: event.target.value }))} className="h-12 w-full rounded-xl border px-3"><option value="">Swiftline / direct contractor</option>{partners.map((item) => <option key={item._id} value={item._id}>{item.name} ({item.code})</option>)}</select><input required value={assignment.partnerReference} onChange={(event) => setAssignment((value) => ({ ...value, partnerReference: event.target.value }))} placeholder="Partner delivery reference" className="h-12 w-full rounded-xl border px-3 uppercase" /><input type="datetime-local" value={assignment.expectedDeliveryAt} onChange={(event) => setAssignment((value) => ({ ...value, expectedDeliveryAt: event.target.value }))} className="h-12 w-full rounded-xl border px-3" /></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowAssign(false)} className="h-10 rounded-full border px-4">Cancel</button><button disabled={busy || optionsLoading || !people.length} className="h-10 rounded-full bg-[#0D1282] px-5 font-semibold text-white disabled:bg-slate-400">Assign</button></div></form></div> : null}

    {showPartner ? <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/50 sm:items-center sm:p-4"><form onSubmit={addPartner} className="my-auto max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"><h2 className="text-xl font-bold">Add delivery partner</h2><p className="mt-1 text-sm text-slate-500">The partner will become available for delivery-person and assignment selection.</p>{partnerError ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{partnerError}</div> : null}<div className="mt-4 grid gap-3 sm:grid-cols-2"><input required value={partner.name} onChange={(event) => { setPartnerError(""); setPartner((value) => ({ ...value, name: event.target.value })); }} placeholder="Partner company name" className="h-12 rounded-xl border px-3" /><input required value={partner.code} onChange={(event) => { setPartnerError(""); setPartner((value) => ({ ...value, code: event.target.value })); }} placeholder="Unique partner code" className="h-12 rounded-xl border px-3 uppercase" /><input required value={partner.countries} onChange={(event) => setPartner((value) => ({ ...value, countries: event.target.value }))} placeholder="Country codes: GB, US" className="h-12 rounded-xl border px-3 uppercase sm:col-span-2" /><input value={partner.contactName} onChange={(event) => setPartner((value) => ({ ...value, contactName: event.target.value }))} placeholder="Contact name" className="h-12 rounded-xl border px-3" /><input type="email" value={partner.email} onChange={(event) => setPartner((value) => ({ ...value, email: event.target.value }))} placeholder="Contact email" className="h-12 rounded-xl border px-3" /><input value={partner.phone} onChange={(event) => setPartner((value) => ({ ...value, phone: event.target.value }))} placeholder="International phone" className="h-12 rounded-xl border px-3" /><input value={partner.contractReference} onChange={(event) => setPartner((value) => ({ ...value, contractReference: event.target.value }))} placeholder="Contract reference" className="h-12 rounded-xl border px-3" /></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setPartnerError(""); setShowPartner(false); }} className="h-10 rounded-full border px-4">Cancel</button><button disabled={busy} className="h-10 rounded-full bg-[#0D1282] px-5 font-semibold text-white disabled:bg-slate-400">{busy ? "Creating…" : "Create partner"}</button></div></form></div> : null}
  </div>;
}
