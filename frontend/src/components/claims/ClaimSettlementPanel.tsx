"use client";

import { useRef, useState } from "react";
import { FiAlertTriangle, FiCheck, FiEye, FiEyeOff, FiShield, FiUpload } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatDashboardDate } from "@/lib/dateFormat";
import ClaimActionDialog from "./ClaimActionDialog";
import {
  claimLabel,
  formatClaimAmount,
  recordClaimSettlement,
  revealClaimBeneficiary,
  saveClaimRecovery,
  toMinorUnits,
  uploadStaffClaimDocument,
  verifyClaimBeneficiary,
  type ClaimBeneficiaryRecord,
  type ClaimDocumentSummary,
  type ClaimRecoveryRecord,
  type ClaimSettlementRecord
} from "@/lib/claims";

/**
 * Verifying bank details, recording a payment, and chasing the carrier.
 *
 * The portal does not move money. A transfer happens through Swiftline's own
 * banking process and is recorded here with its reference and proof, which is
 * why the proof field is required rather than optional.
 */
export default function ClaimSettlementPanel({
  claimId,
  approvedAmountMinor,
  paidAmountMinor,
  beneficiary,
  beneficiaryId,
  settlements,
  recoveries,
  documents,
  canPay,
  canManageRecovery,
  onChanged
}: {
  claimId: string;
  approvedAmountMinor: number | null | undefined;
  paidAmountMinor: number | null | undefined;
  beneficiary: ClaimBeneficiaryRecord | null;
  beneficiaryId: string | null;
  settlements: ClaimSettlementRecord[];
  recoveries: ClaimRecoveryRecord[];
  documents: ClaimDocumentSummary[];
  canPay: boolean;
  canManageRecovery: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState({
    amount: "",
    transactionReference: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    proofDocumentId: ""
  });
  const [recovery, setRecovery] = useState({
    partyType: "CARRIER" as "CARRIER" | "PARTNER" | "INSURER",
    partyName: "",
    externalReference: "",
    submitted: "",
    admitted: "",
    received: ""
  });

  const [rejectingBank, setRejectingBank] = useState(false);
  /** Held only while the eye is open; cleared on toggle and never persisted. */
  const [revealed, setRevealed] = useState<{ accountNumber: string } | null>(null);
  const proofInput = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  /**
   * The key identifying this payment attempt.
   *
   * Minted on first use inside an event handler rather than during render, and
   * then held: a double-click or a retry after a network failure must send the
   * same key so the server recognises it as one payment rather than recording a
   * second payout.
   */
  function paymentIdempotencyKey() {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `claim-settlement:${claimId}:${crypto.randomUUID()}`;
    }
    return idempotencyKeyRef.current;
  }

  /**
   * Retires the key once a payment has actually landed.
   *
   * The key must survive a retry — that is the whole point — but it must not
   * survive a *success*. Now that a claim can be paid in instalments, a second
   * payment carrying the first one's key would be recognised as a replay and
   * silently discarded, leaving the balance unpaid with nothing to show why.
   */
  function retirePaymentKey() {
    idempotencyKeyRef.current = null;
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  // Reversed and failed payments are excluded: money that came back is not
  // money the client has.
  const paidSoFar = settlements
    .filter((entry) => entry.state === "RECORDED")
    .reduce((total, entry) => total + entry.paidAmountMinor, 0);
  const outstandingMinor = Math.max(0, (approvedAmountMinor ?? 0) - paidSoFar);

  const recovered = recoveries.reduce((total, item) => total + item.receivedAmountMinor, 0);
  const exposure = Math.max(0, (paidAmountMinor ?? 0) - recovered);

  return (
    <div className="space-y-5">
      <ClaimActionDialog
        open={rejectingBank}
        title="Reject these bank details"
        description="The client is emailed and asked to correct them. The reason is shown to them."
        confirmLabel="Reject them"
        tone="danger"
        busy={busy}
        fields={[
          {
            kind: "textarea",
            name: "reason",
            label: "What is wrong with them?",
            placeholder: "e.g. The account holder name does not match the registered business."
          }
        ]}
        onClose={() => setRejectingBank(false)}
        onConfirm={(values) => {
          setRejectingBank(false);
          if (!beneficiaryId) return;
          void run(
            () =>
              verifyClaimBeneficiary(claimId, beneficiaryId, {
                approved: false,
                reason: values.reason
              }),
            "Bank details rejected."
          );
        }}
      />

      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Settlement</h2>
        </header>

        <div className="space-y-4 px-5 py-4">
          {beneficiary ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">
                {beneficiary.accountHolderName}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                <span>{beneficiary.bankName}</span>
                <span>·</span>
                {/* Masked until asked for. The full number is fetched on demand,
                    held in state only, and never cached or logged — the reveal
                    itself is recorded server-side. */}
                <span className={revealed ? "font-mono font-semibold text-slate-900" : ""}>
                  {revealed?.accountNumber ?? beneficiary.accountNumberMasked}
                </span>
                {canPay && beneficiaryId ? (
                  <button
                    type="button"
                    disabled={busy}
                    title={revealed ? "Hide the account number" : "Show the full account number"}
                    aria-label={revealed ? "Hide the account number" : "Show the full account number"}
                    onClick={() => {
                      if (revealed) {
                        setRevealed(null);
                        return;
                      }
                      setBusy(true);
                      void revealClaimBeneficiary(claimId, beneficiaryId)
                        .then(setRevealed)
                        .catch((caught) =>
                          toast.error(
                            caught instanceof Error
                              ? caught.message
                              : "The account number could not be shown."
                          )
                        )
                        .finally(() => setBusy(false));
                    }}
                    className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-40"
                  >
                    {revealed ? <FiEyeOff /> : <FiEye />}
                  </button>
                ) : null}
                <span>·</span>
                <span>{beneficiary.ifsc}</span>
                <span>·</span>
                <span>{claimLabel(beneficiary.accountType)}</span>
              </p>
              <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
                Version {beneficiary.version} · {claimLabel(beneficiary.state)}
              </p>

              {beneficiary.state === "SUBMITTED" && beneficiaryId ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => verifyClaimBeneficiary(claimId, beneficiaryId, { approved: true }),
                        "Bank details verified."
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    <FiCheck /> Verify
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRejectingBank(true)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              The client has not submitted bank details yet.
            </p>
          )}

          {settlements.length > 0 ? (
            <ul className="space-y-2">
              {settlements.map((settlement) => (
                <li
                  key={settlement._id}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5"
                >
                  <p className="text-sm font-semibold text-emerald-900">
                    {formatClaimAmount(settlement.paidAmountMinor)} paid ·{" "}
                    {settlement.transactionReference}
                  </p>
                  <p className="text-xs text-emerald-800">
                    {formatDashboardDate(settlement.paymentDate)} · beneficiary v
                    {settlement.beneficiaryVersion} · {claimLabel(settlement.state)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Shown while anything is still owed, not merely while nothing has
              been paid. A claim can be settled in instalments, and a reopened one
              may already carry a payment against its earlier decision. */}
          {canPay && beneficiary?.state === "VERIFIED" && outstandingMinor > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Record the bank payment</p>
                {paidSoFar > 0 ? (
                  <p className="text-xs font-semibold text-amber-700">
                    {formatClaimAmount(paidSoFar)} of {formatClaimAmount(approvedAmountMinor)} paid ·{" "}
                    {formatClaimAmount(outstandingMinor)} outstanding
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Amount paid (₹)</span>
                  <input
                    value={payment.amount}
                    onChange={(event) =>
                      setPayment((current) => ({ ...current, amount: event.target.value }))
                    }
                    placeholder={outstandingMinor ? String(outstandingMinor / 100) : "0.00"}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Bank reference / UTR</span>
                  <input
                    value={payment.transactionReference}
                    onChange={(event) =>
                      setPayment((current) => ({
                        ...current,
                        transactionReference: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Payment date</span>
                  <input
                    type="date"
                    value={payment.paymentDate}
                    onChange={(event) =>
                      setPayment((current) => ({ ...current, paymentDate: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Payment proof</span>
                  <select
                    value={payment.proofDocumentId}
                    onChange={(event) =>
                      setPayment((current) => ({
                        ...current,
                        proofDocumentId: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                  >
                    <option value="">Select an uploaded document</option>
                    {documents.map((document) => (
                      <option key={document._id} value={document._id}>
                        {document.originalName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={proofInput}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void run(async () => {
                      const result = await uploadStaffClaimDocument(
                        claimId,
                        "PAYMENT_PROOF",
                        file,
                        // Its own S3 prefix, so financial records stay separable
                        // from the client's evidence.
                        { storageType: "payment-proof" }
                      );
                      setPayment((current) => ({
                        ...current,
                        proofDocumentId: result.documentId
                      }));
                    }, "Payment proof uploaded.");
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => proofInput.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <FiUpload /> Upload bank confirmation
                </button>
                <p className="text-xs text-slate-500">
                  Only a confirmed payment settles the claim.
                </p>
              </div>

              <button
                type="button"
                disabled={
                  busy ||
                  !payment.transactionReference.trim() ||
                  !payment.proofDocumentId ||
                  toMinorUnits(payment.amount) === null
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await recordClaimSettlement(claimId, {
                      paidAmountMinor: toMinorUnits(payment.amount) as number,
                      transactionReference: payment.transactionReference,
                      paymentDate: payment.paymentDate,
                      proofDocumentId: payment.proofDocumentId,
                      idempotencyKey: paymentIdempotencyKey()
                    });

                    // Only on success. A failed attempt keeps its key so a retry
                    // is recognised as the same payment rather than a second one.
                    retirePaymentKey();
                    setPayment((current) => ({
                      ...current,
                      amount: "",
                      transactionReference: "",
                      proofDocumentId: ""
                    }));
                    toast.success(result.message ?? "Payment recorded.");
                    onChanged();
                  } catch (caught) {
                    toast.error(
                      caught instanceof Error ? caught.message : "The payment could not be recorded."
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Record payment
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {canManageRecovery ? (
        <section className="rounded-2xl border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Carrier / insurer recovery
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Kept separate from the customer&apos;s claim. Recovery never delays or reopens a
              settled claim.
            </p>
          </header>

          <div className="space-y-4 px-5 py-4">
            {recoveries.map((item) => (
              <div key={item._id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {item.partyName}
                    <span className="ml-2 text-xs font-normal uppercase text-slate-500">
                      {claimLabel(item.partyType)}
                    </span>
                  </p>
                  <span className="text-xs font-semibold uppercase text-slate-600">
                    {claimLabel(item.state)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Claimed {formatClaimAmount(item.submittedAmountMinor)} · Admitted{" "}
                  {formatClaimAmount(item.admittedAmountMinor)} · Received{" "}
                  {formatClaimAmount(item.receivedAmountMinor)}
                </p>
                {item.filedOutsideCarrierWindow ? (
                  <p className="mt-2 flex items-start gap-2 text-xs text-amber-800">
                    <FiAlertTriangle className="mt-0.5 shrink-0" />
                    This claim reached us after the carrier&apos;s own notification window closed, so
                    recovery is unlikely.
                  </p>
                ) : null}
              </div>
            ))}

            {(paidAmountMinor ?? 0) > 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <FiShield className="shrink-0 text-slate-500" />
                <span className="text-slate-700">
                  Paid to customer {formatClaimAmount(paidAmountMinor)} · Recovered{" "}
                  {formatClaimAmount(recovered)} ·{" "}
                  <span className="font-semibold">
                    Swiftline exposure {formatClaimAmount(exposure)}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Party</span>
                <select
                  value={recovery.partyType}
                  onChange={(event) =>
                    setRecovery((current) => ({
                      ...current,
                      partyType: event.target.value as typeof current.partyType
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                >
                  <option value="CARRIER">Carrier</option>
                  <option value="PARTNER">Partner</option>
                  <option value="INSURER">Insurer</option>
                </select>
              </label>

              {(
                [
                  ["partyName", "Name"],
                  ["externalReference", "Their reference"],
                  ["submitted", "Amount claimed (₹)"],
                  ["admitted", "Amount admitted (₹)"],
                  ["received", "Amount received (₹)"]
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="block">
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  <input
                    value={recovery[field]}
                    onChange={(event) =>
                      setRecovery((current) => ({ ...current, [field]: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                  />
                </label>
              ))}

              <div className="sm:col-span-2">
                <button
                  type="button"
                  disabled={busy || !recovery.partyName.trim()}
                  onClick={() =>
                    void run(
                      () =>
                        saveClaimRecovery(claimId, {
                          partyType: recovery.partyType,
                          partyName: recovery.partyName,
                          externalReference: recovery.externalReference || undefined,
                          submittedAmountMinor: toMinorUnits(recovery.submitted) ?? undefined,
                          admittedAmountMinor: toMinorUnits(recovery.admitted) ?? undefined,
                          receivedAmountMinor: toMinorUnits(recovery.received) ?? undefined
                        }),
                      "Recovery case saved."
                    )
                  }
                  className="rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Save recovery case
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
