"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiChevronDown,
  FiInfo,
  FiSend
} from "react-icons/fi";
import { toast } from "react-toastify";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import ClaimEvidencePanel from "@/components/claims/ClaimEvidencePanel";
import ClaimShipmentPanel from "@/components/claims/ClaimShipmentPanel";
import { getClientDashboard, type ClientDashboardAccount } from "@/lib/clientDashboard";
import { formatDashboardDate } from "@/lib/dateFormat";
import {
  checkEligibility,
  claimCategories,
  createClaim,
  formatClaimAmount,
  getClaim,
  listClaimableShipments,
  saveClaimDraft,
  submitClaim,
  toMinorUnits,
  type ClaimCategory,
  type ClaimDetail,
  type ClaimableShipment
} from "@/lib/claims";
import { useClientUser } from "@/lib/useClientUser";

/**
 * The claim wizard.
 *
 * Six steps, but the draft is created after step 2 so that everything from the
 * evidence step onward has a claim id to attach to. That is also what makes the
 * wizard resumable: a client who closes the tab keeps their draft.
 */

const steps = [
  "Shipment",
  "Claim type",
  "What happened",
  "Evidence",
  "Declaration",
  "Submit"
] as const;

/**
 * PROVISIONAL declaration wording — Legal has not supplied the binding text.
 *
 * Must stay in step with `claimDeclaration.ts` on the server, which stores this
 * against every claim as version "1.0-draft". If these two drift, the wording a
 * client agreed to is not the wording on record, which is exactly the thing a
 * stored declaration exists to prove.
 */
const declarationPoints = [
  "The information I have given in this claim is accurate and complete to the best of my knowledge.",
  "The documents and photographs I have supplied are genuine and relate to this shipment.",
  "This loss has not been, and will not be, compensated by any insurer, carrier, or other party.",
  "Swiftline may contact the carrier, its agents, and any partner involved in this shipment to investigate this claim.",
  "I will retain the goods and their packaging in their current condition until Swiftline confirms no inspection is required.",
  "Any bank details I provide for settlement will be verified by Swiftline before any payment is made."
];

/**
 * The wizard itself, split out from the exported page.
 *
 * `useSearchParams` makes everything up to the nearest Suspense boundary
 * client-rendered, and without one the whole route fails to prerender. Keeping
 * the boundary in the page below means the shell is still served as static HTML
 * while this part hydrates.
 */
function NewClaimWizard() {
  const { user, loading } = useClientUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedShipment = searchParams.get("shipmentId");
  // Set when the client arrived from Help Desk or a POD dispute, so the claim
  // records where the problem was first reported.
  const linkedSupportTicketId = searchParams.get("ticketId");
  const linkedPodDisputeId = searchParams.get("disputeId");
  /**
   * Set when reopening a saved draft.
   *
   * The wizard's answers live in local state, so without this a client who
   * closed the tab could see their draft in the list but had no way back into
   * the form that fills it in.
   */
  const resumeClaimId = searchParams.get("claimId");

  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [shipments, setShipments] = useState<ClaimableShipment[]>([]);
  const [shipmentDraftId, setShipmentDraftId] = useState(preselectedShipment ?? "");
  const [eligibilityMessage, setEligibilityMessage] = useState("");
  const [lateWarning, setLateWarning] = useState(false);

  const [category, setCategory] = useState<ClaimCategory | "">("");
  const [claimId, setClaimId] = useState("");
  const [detail, setDetail] = useState<ClaimDetail | null>(null);

  const [amount, setAmount] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [description, setDescription] = useState("");
  const [packagingCondition, setPackagingCondition] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [affected, setAffected] = useState<Record<string, number>>({});

  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    getClientDashboard()
      .then((result) => {
        const active = result.accounts.filter((item) => item.membership.status === "active");
        setAccounts(active);
        if (active[0]) setBusinessAccountId(active[0].account.id);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Business accounts could not be loaded.")
      )
      .finally(() => setPageLoading(false));
  }, [user]);

  useEffect(() => {
    if (!businessAccountId) return;
    void listClaimableShipments(businessAccountId)
      .then(setShipments)
      .catch(() => setShipments([]));
  }, [businessAccountId]);

  // Checked as soon as a shipment is picked so an ineligible one is refused
  // before the client fills in six screens.
  useEffect(() => {
    // Deferred so the clearing branch does not set state synchronously in the
    // effect body, which cascades a render on every shipment change.
    void Promise.resolve().then(async () => {
      if (!shipmentDraftId) {
        setEligibilityMessage("");
        setLateWarning(false);
        return;
      }
      try {
        const result = await checkEligibility(shipmentDraftId);
        setEligibilityMessage(result.eligible ? "" : (result.message ?? ""));
        setLateWarning(result.requiresStaffReview);
      } catch (caught) {
        setEligibilityMessage(caught instanceof Error ? caught.message : "Shipment not found.");
      }
    });
  }, [shipmentDraftId]);

  const reloadDetail = useCallback(async () => {
    if (!claimId) return;
    try {
      setDetail(await getClaim("client", claimId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be loaded.");
    }
  }, [claimId]);

  // Reopens a saved draft and refills the form from it, landing on the step
  // where the client left off rather than making them start again.
  useEffect(() => {
    if (!user || !resumeClaimId) return;

    void Promise.resolve().then(async () => {
      try {
        const existing = await getClaim("client", resumeClaimId);
        if (existing.claim.status !== "DRAFT") {
          setError("This claim has already been submitted.");
          return;
        }

        setClaimId(resumeClaimId);
        setDetail(existing);
        setShipmentDraftId(existing.claim.shipmentDraftId);
        setCategory(existing.claim.category);
        setDescription(existing.claim.description);
        setPackagingCondition(existing.claim.packagingCondition);
        setIncidentDate(existing.claim.incidentDate?.slice(0, 10) ?? "");
        if (existing.claim.requestedAmountMinor) {
          setAmount(String(existing.claim.requestedAmountMinor / 100));
        }
        setAffected(
          Object.fromEntries(
            existing.claim.affectedItems.map((item) => [
              `${item.parcelSequence}:${item.itemIndex}`,
              item.quantityAffected
            ])
          )
        );
        // Straight to "What happened" — the shipment and category are already
        // chosen, and making someone re-pick them would be busywork.
        setStep(2);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That draft could not be opened.");
      }
    });
  }, [user, resumeClaimId]);

  const snapshot = detail?.claim.shipmentSnapshot ?? null;

  const declaredTotalMinor = snapshot?.totalDeclaredValueMinor ?? 0;
  const requestedMinor = toMinorUnits(amount);
  // Allowed but flagged prominently: a client may legitimately claim more than
  // the declared value, and a reviewer weighs that rather than the portal.
  const exceedsDeclared =
    requestedMinor !== null && declaredTotalMinor > 0 && requestedMinor > declaredTotalMinor;

  const affectedItemsPayload = useMemo(
    () =>
      Object.entries(affected)
        .filter(([, quantity]) => quantity > 0)
        .map(([key, quantity]) => {
          const [parcelSequence, itemIndex] = key.split(":").map(Number);
          return { parcelSequence, itemIndex, quantityAffected: quantity };
        }),
    [affected]
  );

  /** Creates the draft, which is what makes steps 4 onward possible. */
  async function startDraft() {
    if (!shipmentDraftId || !category) return;
    setBusy(true);
    setError("");
    try {
      const claim = await createClaim({
        shipmentDraftId,
        category,
        linkedSupportTicketId,
        linkedPodDisputeId
      });
      setClaimId(claim.id);
      setDetail(await getClaim("client", claim.id));
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!claimId) return;
    if (requestedMinor === null) {
      setError("Enter the amount you are claiming.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Describe what happened in a little more detail.");
      return;
    }
    if (affectedItemsPayload.length === 0) {
      setError("Select at least one affected item.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await saveClaimDraft(claimId, {
        requestedAmountMinor: requestedMinor,
        incidentDate: incidentDate || null,
        description,
        packagingCondition,
        contactName,
        contactPhone,
        contactEmail,
        affectedParcelSequences: [
          ...new Set(affectedItemsPayload.map((item) => item.parcelSequence))
        ],
        affectedItems: affectedItemsPayload
      });
      await reloadDetail();
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function finalSubmit() {
    if (!claimId) return;
    setBusy(true);
    setError("");
    try {
      const result = await submitClaim(claimId);
      toast.success(result.message);
      router.push(`/client/claims/${claimId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be submitted.");
      setBusy(false);
    }
  }

  if (loading || !user || pageLoading) return <ClientDashboardLoading />;

  const canLeaveStepOne = Boolean(shipmentDraftId) && !eligibilityMessage;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/client/claims"
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-900"
      >
        <FiArrowLeft />
        Claims
      </Link>

      <h1 className="text-2xl font-bold text-slate-900">Raise a claim</h1>
      <p className="mt-1 text-sm text-slate-500">
        You can submit before every document is ready — the filing date is what matters, and we will
        ask for anything outstanding afterwards.
      </p>

      {/* Steps are shown but not clickable: jumping ahead would skip the draft
          creation that later steps depend on. */}
      <ol className="my-6 flex flex-wrap gap-2">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              index === step
                ? "border-blue-900 bg-blue-900 text-white"
                : index < step
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {index < step ? <FiCheck /> : <span>{index + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Step 1 — pick the shipment */}
      {step === 0 ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          {accounts.length > 1 ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Business account</span>
              <div className="relative mt-1">
                <select
                  value={businessAccountId}
                  onChange={(event) => {
                    setBusinessAccountId(event.target.value);
                    setShipmentDraftId("");
                  }}
                  className="w-full appearance-none rounded-xl border border-slate-300 py-2.5 pl-4 pr-10 text-sm"
                >
                  {accounts.map((item) => (
                    <option key={item.account.id} value={item.account.id}>
                      {item.account.company.companyName}
                    </option>
                  ))}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </label>
          ) : null}

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Shipment</span>
            <div className="relative mt-1">
              <select
                value={shipmentDraftId}
                onChange={(event) => setShipmentDraftId(event.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-300 py-2.5 pl-4 pr-10 text-sm"
              >
                <option value="">Select a shipment</option>
                {shipments.map((shipment) => (
                  <option key={shipment.shipmentDraftId} value={shipment.shipmentDraftId}>
                    {shipment.trackingNumber || "No tracking number"} —{" "}
                    {shipment.parcelCount} parcel{shipment.parcelCount === 1 ? "" : "s"}
                    {shipment.bookedAt ? ` — booked ${formatDashboardDate(shipment.bookedAt)}` : ""}
                  </option>
                ))}
              </select>
              <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            {shipments.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Only booked and collected shipments without an open claim can be claimed for.
              </p>
            ) : null}
          </label>

          {eligibilityMessage ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <FiAlertTriangle className="mt-0.5 shrink-0 text-amber-700" />
              <p className="text-sm text-amber-900">{eligibilityMessage}</p>
            </div>
          ) : null}

          {lateWarning ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <FiInfo className="mt-0.5 shrink-0 text-amber-700" />
              <p className="text-sm text-amber-900">
                The usual filing window for this shipment has passed. You can still submit and our
                team will review whether it can be accepted.
              </p>
            </div>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canLeaveStepOne}
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
            >
              Continue <FiArrowRight />
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 2 — claim type */}
      {step === 1 ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">
            Choose what went wrong. This decides which documents we will need from you.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {claimCategories.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCategory(option.value)}
                className={`rounded-xl border p-4 text-left transition ${
                  category === option.value
                    ? "border-blue-900 bg-blue-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                <p className="mt-1 text-xs text-slate-500">{option.help}</p>
              </button>
            ))}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!category || busy}
              onClick={() => void startDraft()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
            >
              {busy ? "Starting..." : "Continue"} <FiArrowRight />
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 3 — what happened, and which items */}
      {step === 2 && snapshot ? (
        <div className="space-y-5">
          <ClaimShipmentPanel snapshot={snapshot} />

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Affected items
            </h2>
            <p className="text-xs text-slate-500">
              Enter how many units of each item were lost or damaged.
            </p>

            <div className="space-y-3">
              {snapshot.parcels.map((parcel) =>
                parcel.items.map((item) => {
                  const key = `${parcel.sequence}:${item.itemIndex}`;
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {item.description || "Unnamed item"}
                        </p>
                        <p className="text-xs text-slate-500">
                          Parcel {parcel.sequence} · {item.quantity} shipped ·{" "}
                          {formatClaimAmount(item.unitRateMinor)} each
                        </p>
                      </div>
                      <label className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-600">Affected</span>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={affected[key] ?? ""}
                          onChange={(event) =>
                            setAffected((current) => ({
                              ...current,
                              [key]: Math.min(Number(event.target.value) || 0, item.quantity)
                            }))
                          }
                          className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Claim details
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Amount claimed (₹)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Date you discovered the problem
                </span>
                <input
                  type="date"
                  value={incidentDate}
                  onChange={(event) => setIncidentDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
              </label>
            </div>

            {exceedsDeclared ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
                <FiAlertTriangle className="mt-0.5 shrink-0 text-amber-700" />
                <div className="text-sm text-amber-900">
                  <p className="font-semibold">
                    This is more than the value declared when the shipment was booked.
                  </p>
                  <p className="mt-1">
                    Declared: {formatClaimAmount(declaredTotalMinor)} · Claiming:{" "}
                    {formatClaimAmount(requestedMinor)}. You can still submit, but settlement is
                    usually limited to the declared value unless you can evidence otherwise.
                  </p>
                </div>
              </div>
            ) : null}

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">What happened?</span>
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                placeholder="Describe the loss or damage and when you noticed it."
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                Condition of the packaging
              </span>
              <textarea
                rows={2}
                value={packagingCondition}
                onChange={(event) => setPackagingCondition(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                placeholder="Was the outer box damaged, opened, or resealed?"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Contact name</span>
                <input
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Phone</span>
                <input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email</span>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
              </label>
            </div>

            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveDetails()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
              >
                {busy ? "Saving..." : "Continue"} <FiArrowRight />
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Step 4 — evidence */}
      {step === 3 && detail ? (
        <div className="space-y-5">
          <ClaimEvidencePanel
            claimId={claimId}
            checklist={detail.checklist}
            documents={detail.documents}
            onChanged={() => void reloadDetail()}
          />

          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <FiInfo className="mt-0.5 shrink-0 text-blue-800" />
            <p className="text-sm text-blue-900">
              You do not have to upload everything now. Submitting fixes your filing date, and we
              will ask for anything still outstanding.
            </p>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Continue <FiArrowRight />
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 5 — declaration */}
      {step === 4 ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Declaration</h2>

          <ul className="space-y-2">
            {declarationPoints.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm text-slate-700">
                <FiCheck className="mt-0.5 shrink-0 text-emerald-600" />
                {point}
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={declarationAccepted}
              onChange={(event) => setDeclarationAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-sm font-semibold text-slate-800">
              I confirm the above on behalf of my company.
            </span>
          </label>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!declarationAccepted}
              onClick={() => setStep(5)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
            >
              Continue <FiArrowRight />
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 6 — review and submit */}
      {step === 5 && detail ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Review and submit
          </h2>

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Shipment</dt>
              <dd className="text-sm font-medium text-slate-900">
                {snapshot?.trackingNumber || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Claim type</dt>
              <dd className="text-sm font-medium text-slate-900">
                {claimCategories.find((option) => option.value === category)?.label}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Amount claimed</dt>
              <dd className="text-sm font-medium text-slate-900">
                {formatClaimAmount(requestedMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Evidence</dt>
              <dd className="text-sm font-medium text-slate-900">
                {detail.checklist.complete
                  ? "Complete"
                  : `${detail.checklist.missingCount} document(s) outstanding`}
              </dd>
            </div>
          </dl>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void finalSubmit()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
            >
              <FiSend />
              {busy ? "Submitting..." : "Submit claim"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function NewClaimPage() {
  return (
    <Suspense fallback={<ClientDashboardLoading />}>
      <NewClaimWizard />
    </Suspense>
  );
}
