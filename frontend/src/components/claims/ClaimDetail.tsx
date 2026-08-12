"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiAlertTriangle, FiClock, FiEdit3, FiFileText, FiSend } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import {
  acceptClaimSettlement,
  appealClaim,
  claimLabel,
  formatClaimAmount,
  getClaim,
  openDecisionLetter,
  postClaimMessage,
  disputeClaimSettlement,
  submitClaimBeneficiary,
  withdrawClaim,
  type ClaimAudience,
  type ClaimDetail as ClaimDetailData
} from "@/lib/claims";
import ClaimActionDialog, { type DialogField } from "./ClaimActionDialog";
import ClaimEvidencePanel from "./ClaimEvidencePanel";
import ClaimShipmentPanel from "./ClaimShipmentPanel";
import { ClaimOutcomeNote, ClaimStatusBadge } from "./ClaimStatusBadge";

/**
 * A single claim, as the client sees it.
 *
 * Which actions appear is driven by `availableActions` from the server rather
 * than by re-deriving the state machine here — two implementations of the same
 * rules would eventually disagree, and the server's is the one that counts.
 */
export default function ClaimDetail({
  claimId,
  audience = "client"
}: {
  claimId: string;
  audience?: ClaimAudience;
}) {
  const [data, setData] = useState<ClaimDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [appealReason, setAppealReason] = useState("");
  const [showAppeal, setShowAppeal] = useState(false);
  const [showBank, setShowBank] = useState(false);
  const [busy, setBusy] = useState(false);

  const [bank, setBank] = useState({
    accountHolderName: "",
    accountNumber: "",
    confirmAccountNumber: "",
    ifsc: "",
    bankName: "",
    accountType: "CURRENT" as "SAVINGS" | "CURRENT"
  });
  const [bankTouched, setBankTouched] = useState<Record<string, boolean>>({});

  /** The one open dialog, if any. See the workspace for the same pattern. */
  const [dialog, setDialog] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    tone?: "primary" | "danger";
    fields: DialogField[];
    onConfirm: (values: Record<string, string>) => Promise<unknown>;
  } | null>(null);

  /**
   * Validated here as well as on the server, so a mistyped account number is
   * caught against the field that caused it rather than returned as a sentence
   * in a toast with the form already closed.
   */
  const bankErrors: Record<string, string> = {};
  if (!bank.accountHolderName.trim()) bankErrors.accountHolderName = "Enter the account holder's name.";
  if (!bank.bankName.trim()) bankErrors.bankName = "Enter the bank name.";
  if (!/^[0-9]{9,18}$/.test(bank.accountNumber.replace(/\s+/g, ""))) {
    bankErrors.accountNumber = "An account number is 9 to 18 digits.";
  }
  if (bank.confirmAccountNumber !== bank.accountNumber) {
    bankErrors.confirmAccountNumber = "This does not match the account number above.";
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.toUpperCase())) {
    // Spelled out because the format is not guessable — four letters, a zero,
    // then six characters, e.g. HDFC0001234.
    bankErrors.ifsc = "An IFSC is 4 letters, a zero, then 6 characters. e.g. HDFC0001234";
  }

  /**
   * Reloads the claim.
   *
   * The full-page loading state is shown only when there is nothing on screen
   * yet. Refreshing after an upload or an action keeps the current view in place
   * — swapping the whole page for a spinner on every file added is disorienting,
   * and loses the reader's scroll position.
   */
  const load = useCallback(async () => {
    try {
      setData(await getClaim(audience, claimId));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [audience, claimId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">
        Loading claim...
      </div>
    );

  if (error || !data)
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || "Claim not found."}
      </div>
    );

  const { claim, checklist, documents, messages, events, decision, beneficiary } = data;
  const can = (action: string) => data.availableActions.includes(action);

  return (
    <div className="space-y-5">
      <ClaimActionDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        fields={dialog?.fields ?? []}
        confirmLabel={dialog?.confirmLabel}
        tone={dialog?.tone}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(values) => {
          const pending = dialog;
          setDialog(null);
          void pending?.onConfirm(values);
        }}
      />

      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900">
                {claim.claimNumber ?? "Draft claim"}
              </h1>
              <ClaimStatusBadge status={claim.status} decisionOutcome={claim.decisionOutcome} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {claimLabel(claim.category)}
              {claim.submittedAt ? ` · Filed ${formatDashboardDate(claim.submittedAt)}` : ""}
            </p>
            {/* Reads as a sequence rather than a second status: approved, and
                now waiting to be paid. */}
            {claim.decisionOutcome ? (
              <p className="mt-1">
                <ClaimOutcomeNote outcome={claim.decisionOutcome} />
                {claim.approvedAmountMinor ? (
                  <span className="text-sm text-slate-500">
                    {" "}
                    — {formatClaimAmount(claim.approvedAmountMinor)}
                    {claim.status === "PAYMENT_PROCESSING" ? ", awaiting payment" : ""}
                    {claim.status === "SETTLED" ? ", paid" : ""}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          {claim.requestedAmountMinor !== undefined ? (
            <div className="text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Claimed</p>
              <p className="text-lg font-bold text-slate-900">
                {formatClaimAmount(claim.requestedAmountMinor)}
              </p>
              {claim.approvedAmountMinor !== null && claim.approvedAmountMinor !== undefined ? (
                <p className="text-sm font-semibold text-emerald-700">
                  Approved {formatClaimAmount(claim.approvedAmountMinor)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* A draft is not finished, so the detail page is the wrong place to
            land on. The way forward is back into the wizard. */}
        {claim.status === "DRAFT" && audience === "client" ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3.5">
            <FiEdit3 className="mt-0.5 shrink-0 text-blue-800" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold">This claim has not been submitted yet.</p>
              <Link
                href={`/client/claims/new?claimId=${claimId}`}
                className="mt-1 inline-flex font-semibold underline"
              >
                Continue filling it in
              </Link>
            </div>
          </div>
        ) : null}

        {can("WITHDRAW") ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setDialog({
                  title: "Withdraw this claim",
                  description:
                    "The claim is closed and cannot be reopened by you. You can raise a new one for this shipment afterwards.",
                  confirmLabel: "Withdraw it",
                  tone: "danger",
                  fields: [
                    {
                      kind: "textarea",
                      name: "reason",
                      label: "Why are you withdrawing it?",
                      placeholder: "e.g. The parcel turned up."
                    }
                  ],
                  onConfirm: (values) =>
                    run(() => withdrawClaim(claimId, values.reason), "Claim withdrawn.")
                })
              }
              className="text-sm font-semibold text-slate-500 hover:text-red-600 disabled:opacity-40"
            >
              Withdraw this claim
            </button>
          </div>
        ) : null}

        {claim.deadlines?.filedLate ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <FiAlertTriangle className="mt-0.5 shrink-0 text-amber-700" />
            <p className="text-sm text-amber-900">
              This claim was filed after the usual window. Our team is reviewing whether it can be
              accepted.
            </p>
          </div>
        ) : null}

        {claim.status === "DECIDED" && claim.deadlines?.appealDeadlineAt ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5">
            <FiClock className="mt-0.5 shrink-0 text-indigo-700" />
            <p className="text-sm text-indigo-900">
              You can appeal this decision until{" "}
              <span className="font-semibold">
                {formatDashboardDate(claim.deadlines.appealDeadlineAt)}
              </span>
              .
            </p>
          </div>
        ) : null}
      </header>

      {decision ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Decision</h2>
          <p className="mt-2 text-sm text-slate-700">{decision.customerExplanation}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">You claimed</dt>
              <dd className="text-sm font-semibold text-slate-900">
                {formatClaimAmount(decision.requestedAmountMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Declared value</dt>
              <dd className="text-sm font-semibold text-slate-900">
                {formatClaimAmount(decision.declaredValueMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Approved</dt>
              <dd className="text-sm font-semibold text-emerald-700">
                {formatClaimAmount(decision.approvedAmountMinor)}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => void openDecisionLetter(audience, claimId)}
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"
          >
            <FiFileText /> Download the decision letter
          </button>

          <div className="mt-4 flex flex-wrap gap-3">
            {can("ACCEPT_SETTLEMENT") ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowAppeal(false);
                  setAppealReason("");
                  void run(() => acceptClaimSettlement(claimId), "Settlement accepted.");
                }}
                className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                Accept settlement
              </button>
            ) : null}
            {can("SUBMIT_APPEAL") ? (
              <button
                type="button"
                onClick={() => setShowAppeal((current) => !current)}
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
              >
                Appeal this decision
              </button>
            ) : null}
            {/* Disagreeing without appealing: staff see the objection while the
                one appeal the client is allowed stays unspent. */}
            {can("DISPUTE_SETTLEMENT") ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDialog({
                    title: "Record your disagreement",
                    description:
                      "Our team is told you disagree. This does not use up your one appeal, and the appeal deadline is unchanged.",
                    confirmLabel: "Send it",
                    fields: [
                      {
                        kind: "textarea",
                        name: "reason",
                        label: "What do you disagree with?",
                        placeholder: "Tell us which part of the decision you think is wrong."
                      }
                    ],
                    onConfirm: (values) => {
                      setShowAppeal(false);
                      setAppealReason("");
                      return run(
                        () => disputeClaimSettlement(claimId, values.reason),
                        "Your response has been recorded."
                      );
                    }
                  })
                }
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
              >
                I disagree
              </button>
            ) : null}
          </div>

          {showAppeal ? (
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <textarea
                rows={3}
                value={appealReason}
                onChange={(event) => setAppealReason(event.target.value)}
                placeholder="Explain why you are appealing, and mention any new evidence."
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              <button
                type="button"
                disabled={busy || appealReason.trim().length < 10}
                onClick={() =>
                  void run(() => appealClaim(claimId, appealReason), "Appeal submitted.").then(() => {
                    setAppealReason("");
                    setShowAppeal(false);
                  })
                }
                className="rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Submit appeal
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Bank details are asked for only once there is money to pay. */}
      {claim.status === "PAYMENT_PROCESSING" || beneficiary ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Settlement account
          </h2>

          {beneficiary ? (
            <p className="mt-2 text-sm text-slate-700">
              {beneficiary.bankName} · {beneficiary.accountNumberMasked} · {beneficiary.ifsc}
              <span className="ml-2 text-xs font-semibold uppercase text-slate-500">
                {claimLabel(beneficiary.state)}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              Add the bank account this settlement should be paid into. We verify it before paying.
            </p>
          )}

          {!beneficiary || beneficiary.state === "REJECTED" ? (
            <>
              <button
                type="button"
                onClick={() => setShowBank((current) => !current)}
                className="mt-3 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
              >
                {beneficiary ? "Correct bank details" : "Add bank details"}
              </button>

              {showBank ? (
                <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                  {(
                    [
                      ["accountHolderName", "Account holder name", "text"],
                      ["bankName", "Bank name", "text"],
                      ["accountNumber", "Account number", "password"],
                      ["confirmAccountNumber", "Confirm account number", "password"],
                      ["ifsc", "IFSC", "text"]
                    ] as const
                  ).map(([field, label, type]) => {
                    // Shown only once the field has been left, so an error does
                    // not appear while it is still being typed into.
                    const invalid = bankTouched[field] && bankErrors[field];
                    return (
                      <label key={field} className="block">
                        <span className="text-xs font-semibold text-slate-700">{label}</span>
                        <input
                          type={type}
                          value={bank[field]}
                          onChange={(event) =>
                            setBank((current) => ({ ...current, [field]: event.target.value }))
                          }
                          onBlur={() => setBankTouched((current) => ({ ...current, [field]: true }))}
                          className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm ${
                            invalid ? "border-red-400 bg-red-50" : "border-slate-300"
                          }`}
                        />
                        {invalid ? (
                          <span className="mt-1 block text-xs font-medium text-red-600">
                            {bankErrors[field]}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">Account type</span>
                    <select
                      value={bank.accountType}
                      onChange={(event) =>
                        setBank((current) => ({
                          ...current,
                          accountType: event.target.value as "SAVINGS" | "CURRENT"
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    >
                      <option value="CURRENT">Current</option>
                      <option value="SAVINGS">Savings</option>
                    </select>
                  </label>

                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        // Every problem is shown at once, against the field that
                        // caused it. Nothing is sent until they are all cleared,
                        // so the form is never closed on a rejection.
                        if (Object.keys(bankErrors).length > 0) {
                          setBankTouched({
                            accountHolderName: true,
                            bankName: true,
                            accountNumber: true,
                            confirmAccountNumber: true,
                            ifsc: true
                          });
                          return;
                        }

                        setBusy(true);
                        try {
                          await submitClaimBeneficiary(claimId, bank);
                          toast.success("Bank details submitted for verification.");
                          setShowBank(false);
                          setBankTouched({});
                          await load();
                        } catch (caught) {
                          // Kept open with the values intact: a server-side
                          // refusal is something to correct, not to retype.
                          toast.error(
                            caught instanceof Error
                              ? caught.message
                              : "Those bank details could not be saved."
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      Submit bank details
                    </button>
                    {Object.keys(bankErrors).length > 0 &&
                    Object.keys(bankTouched).length > 0 ? (
                      <p className="mt-2 text-xs font-medium text-red-600">
                        Correct the highlighted fields before submitting.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {claim.shipmentSnapshot ? <ClaimShipmentPanel snapshot={claim.shipmentSnapshot} /> : null}

      <ClaimEvidencePanel
        claimId={claimId}
        checklist={checklist}
        documents={documents}
        audience={audience}
        readOnly={["SETTLED", "CLOSED", "WITHDRAWN"].includes(claim.status)}
        onChanged={() => void load()}
      />

      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Messages</h2>
        </header>

        <div className="space-y-3 px-5 py-4">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">No messages yet.</p>
          ) : (
            messages.map((entry) => (
              <div
                key={entry._id}
                className={`rounded-xl border p-3.5 ${
                  entry.authorKind === "CLIENT"
                    ? "border-blue-200 bg-blue-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {entry.authorKind === "CLIENT" ? "You" : "Swiftline"} ·{" "}
                  {formatDashboardDateTime(entry.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-800">{entry.body}</p>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Send a message about this claim"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
          />
          <button
            type="button"
            disabled={busy || !message.trim()}
            onClick={() =>
              void run(
                () => postClaimMessage(audience, claimId, message),
                "Message sent."
              ).then(() => setMessage(""))
            }
            className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            <FiSend />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">History</h2>
        </header>
        <ol className="divide-y divide-slate-100">
          {events.map((entry) => (
            <li key={entry._id} className="px-5 py-3">
              <p className="text-sm font-semibold text-slate-900">{claimLabel(entry.type)}</p>
              {entry.reason ? <p className="text-sm text-slate-600">{entry.reason}</p> : null}
              <p className="mt-0.5 text-xs text-slate-400">
                {formatDashboardDateTime(entry.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
