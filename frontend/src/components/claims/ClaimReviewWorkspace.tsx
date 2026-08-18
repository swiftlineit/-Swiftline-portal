"use client";

import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiCheck, FiFileText, FiSend, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import {
  claimDocumentLabels,
  claimLabel,
  conditionalDocumentOptions,
  formatClaimAmount,
  getStaffClaim,
  openClaimDocument,
  postClaimMessage,
  claimWorkflowActions,
  runClaimWorkflowAction,
  openDecisionLetter,
  requestConditionalDocuments,
  setClaimLegalHold,
  waiveClaimDocument,
  type ClaimDocumentCategory,
  reviewClaimDocument,
  type ClaimWorkflowAction,
  type StaffClaimDetail
} from "@/lib/claims";
import ClaimActionDialog, { type DialogField } from "./ClaimActionDialog";
import ClaimDecisionPanel from "./ClaimDecisionPanel";
import ClaimEvidencePanel from "./ClaimEvidencePanel";
import ClaimSettlementPanel from "./ClaimSettlementPanel";
import ClaimShipmentPanel from "./ClaimShipmentPanel";
import { ClaimOutcomeNote, ClaimStatusBadge } from "./ClaimStatusBadge";

/**
 * The staff review workspace.
 *
 * Laid out as a two-column reading order: the case on the left, the actions on
 * the right. A reviewer decides by reading evidence against declared value, so
 * those sit together rather than behind separate tabs.
 *
 * Which actions are offered comes from the server's `availableActions`, and the
 * role gates below only hide controls- the server refuses regardless.
 */
export default function ClaimReviewWorkspace({
  claimId,
  role
}: {
  claimId: string;
  role: string;
}) {
  const [data, setData] = useState<StaffClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The one open dialog, if any.
   *
   * Held as a single slot rather than a boolean per action: only one can be open
   * at a time, and each action describes its own fields and what to do with them
   * at the point it is triggered.
   */
  const [dialog, setDialog] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    tone?: "primary" | "danger";
    fields: DialogField[];
    onConfirm: (values: Record<string, string>) => Promise<unknown>;
  } | null>(null);

  /**
   * Reloads the claim, keeping the current view in place on a refresh.
   *
   * The full-page loading state is only for the first load. Replacing a
   * workspace a reviewer is reading with a spinner after every action loses
   * their place in a long page.
   */
  const load = useCallback(async () => {
    try {
      setData(await getStaffClaim(claimId));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The claim could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [claimId]);

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

  const { claim, checklist, documents, messages, events, decisions, settlements, recoveries } = data;
  const latestDecision = decisions[0] ?? null;

  // Mirrors the server matrix. Finance pays but cannot decide; delivery reads.
  const canDecide = role === "admin" || role === "operations";
  const canPay = role === "admin" || role === "operations" || role === "finance";
  const canReviewDocuments = canDecide;
  const canMessage = canDecide;

  const declaredValueMinor = claim.shipmentSnapshot?.totalDeclaredValueMinor ?? 0;
  const overdue =
    claim.deadlines?.internalReviewDueAt &&
    new Date(claim.deadlines.internalReviewDueAt) < new Date() &&
    !["SETTLED", "CLOSED", "WITHDRAWN"].includes(claim.status);

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900">
                {claim.claimNumber ?? "Draft claim"}
              </h1>
              <ClaimStatusBadge status={claim.status} decisionOutcome={claim.decisionOutcome} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {claimLabel(claim.category)} ·{" "}
              {claim.shipmentSnapshot?.trackingNumber || "No tracking number"}
              {claim.submittedAt ? ` · Filed ${formatDashboardDate(claim.submittedAt)}` : ""}
            </p>
            {claim.decisionOutcome ? (
              <p className="mt-1">
                <ClaimOutcomeNote outcome={claim.decisionOutcome} />
                {claim.approvedAmountMinor ? (
                  <span className="text-sm text-slate-500">
                    {" "}
                   - {formatClaimAmount(claim.approvedAmountMinor)}
                    {claim.status === "PAYMENT_PROCESSING" ? ", awaiting payment" : ""}
                    {claim.status === "SETTLED" ? ", paid" : ""}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold uppercase text-slate-500">Requested</p>
            <p className="text-lg font-bold text-slate-900">
              {formatClaimAmount(claim.requestedAmountMinor)}
            </p>
            <p className="text-xs text-slate-500">
              Declared {formatClaimAmount(declaredValueMinor)}
            </p>
          </div>
        </div>

        {/* Driven by the server's availableActions rather than by re-deriving
            the state machine here. Without these the workflow has no controls
            at all: a submitted claim could never reach review. */}
        {canDecide ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {(Object.keys(claimWorkflowActions) as ClaimWorkflowAction[])
              .filter((action) => data.availableActions.includes(action))
              .map((action) => {
                const config = claimWorkflowActions[action];
                return (
                  <button
                    key={action}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Actions with nothing to record run straight away; the
                      // rest ask for their reason in the dialog.
                      if (!config.needsReason) {
                        void run(
                          () => runClaimWorkflowAction(claimId, action, ""),
                          `${config.label} done.`
                        );
                        return;
                      }

                      setDialog({
                        title: config.label,
                        description: "The reason is recorded on the claim's history.",
                        confirmLabel: config.label,
                        tone: action === "WITHDRAW" ? "danger" : "primary",
                        fields: [
                          {
                            kind: "textarea",
                            name: "reason",
                            label: "Reason",
                            placeholder: "What should the record say?"
                          }
                        ],
                        onConfirm: (values) =>
                          run(
                            () => runClaimWorkflowAction(claimId, action, values.reason),
                            `${config.label} done.`
                          )
                      });
                    }}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                      action === "CLOSE" || action === "WITHDRAW"
                        ? "border-slate-300 text-slate-600 hover:bg-slate-50"
                        : "border-blue-900 bg-blue-900 text-white hover:bg-blue-800"
                    }`}
                  >
                    {config.label}
                  </button>
                );
              })}
          </div>
        ) : null}

        {/* Evidence and retention controls. Separated from the workflow buttons
            because these change what a claim requires or how long it is kept,
            rather than where it sits in the pipeline. */}
        {canDecide ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setDialog({
                  title: "Waive a required document",
                  description:
                    "The client stops being asked for this, and the claim can proceed without it. The reason is recorded on their timeline.",
                  confirmLabel: "Waive it",
                  fields: [
                    {
                      kind: "select",
                      name: "category",
                      label: "Which document",
                      // Only what this claim actually requires, so nobody has to
                      // remember a code or waive something never asked for.
                      options: checklist.items
                        .filter((item) => item.required && item.state !== "WAIVED")
                        .map((item) => ({
                          value: item.category,
                          label: claimDocumentLabels[item.category]
                        }))
                    },
                    {
                      kind: "textarea",
                      name: "reason",
                      label: "Why can it not be produced?",
                      placeholder: "e.g. The shipper does not itemise consignments of this type."
                    }
                  ],
                  onConfirm: (values) =>
                    run(
                      () =>
                        waiveClaimDocument(
                          claimId,
                          values.category as ClaimDocumentCategory,
                          values.reason
                        ),
                      "Document waived."
                    )
                })
              }
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Waive a document
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setDialog({
                  title: "Request extra evidence",
                  description:
                    "This is added to the client's checklist as required, and they are emailed about it.",
                  confirmLabel: "Request it",
                  fields: [
                    {
                      kind: "select",
                      name: "category",
                      label: "Which document",
                      options: conditionalDocumentOptions
                    },
                    {
                      kind: "textarea",
                      name: "reason",
                      label: "Why is it needed?",
                      placeholder: "e.g. Theft was reported, so we need the police complaint."
                    }
                  ],
                  onConfirm: (values) =>
                    run(
                      () =>
                        requestConditionalDocuments(
                          claimId,
                          [values.category as ClaimDocumentCategory],
                          values.reason
                        ),
                      "Document requested from the client."
                    )
                })
              }
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Request extra evidence
            </button>

            {/* Admin only on the server; shown to operations too so they can see
                a hold exists, but the action will be refused for them. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const holding = data.legalHold?.active ?? false;
                setDialog({
                  title: holding ? "Lift the legal hold" : "Place a legal hold",
                  description: holding
                    ? "Evidence on this claim becomes eligible for deletion again once its retention period passes."
                    : "Evidence on this claim cannot be deleted while the hold is in place, whatever its retention date.",
                  confirmLabel: holding ? "Lift the hold" : "Place the hold",
                  tone: holding ? "danger" : "primary",
                  fields: [
                    {
                      kind: "textarea",
                      name: "reason",
                      label: holding ? "Why is it being lifted?" : "Why is a hold needed?",
                      placeholder: "e.g. Referred to legal following a dispute."
                    }
                  ],
                  onConfirm: (values) =>
                    run(
                      () => setClaimLegalHold(claimId, !holding, values.reason),
                      holding ? "Legal hold lifted." : "Legal hold placed."
                    )
                });
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                data.legalHold?.active
                  ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {data.legalHold?.active ? "Lift legal hold" : "Place legal hold"}
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          {data.legalHold?.active ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
              <FiAlertTriangle />
              Under legal hold- evidence cannot be deleted
            </span>
          ) : null}
          {claim.deadlines?.filedLate ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              <FiAlertTriangle />
              Filed after the permitted window- review before accepting
            </span>
          ) : null}
          {overdue ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
              <FiAlertTriangle />
              Review overdue since{" "}
              {formatDashboardDate(claim.deadlines?.internalReviewDueAt ?? undefined)}
            </span>
          ) : null}
          {claim.appealState === "SUBMITTED" || claim.appealState === "UNDER_REVIEW" ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900">
              Under appeal
            </span>
          ) : null}
        </div>
      </header>

      {/* Split three ways because total elapsed is the number a client feels but
          the wrong number to judge a team on- a claim can sit for weeks because
          nobody chased it, or because the client took weeks to reply. */}
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
        {[
          ["Total elapsed", data.sla.totalHours, "text-slate-900"],
          ["Swiftline time", data.sla.swiftlineHours, data.sla.breached ? "text-red-700" : "text-slate-900"],
          ["Waiting on client", data.sla.clientHours, "text-amber-700"],
          ["Waiting on third party", data.sla.thirdPartyHours, "text-violet-700"]
        ].map(([label, hours, tone]) => (
          <div key={String(label)}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-0.5 text-lg font-bold ${tone}`}>
              {Number(hours) < 24
                ? `${Number(hours).toFixed(1)} h`
                : `${(Number(hours) / 24).toFixed(1)} d`}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {claim.shipmentSnapshot ? (
            <ClaimShipmentPanel snapshot={claim.shipmentSnapshot} />
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                What the client claims
              </h2>
            </header>
            <div className="space-y-4 px-5 py-4">
              <p className="whitespace-pre-line text-sm text-slate-700">
                {claim.description || "No description given."}
              </p>
              {claim.packagingCondition ? (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Packaging condition
                  </p>
                  <p className="text-sm text-slate-700">{claim.packagingCondition}</p>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2">Parcel</th>
                      <th className="px-4 py-2 text-right">Shipped</th>
                      <th className="px-4 py-2 text-right">Affected</th>
                      <th className="px-4 py-2 text-right">Declared value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {claim.affectedItems.map((item) => (
                      <tr key={`${item.parcelSequence}:${item.itemIndex}`}>
                        <td className="px-4 py-2 text-slate-900">
                          {item.descriptionSnapshot || "-"}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{item.parcelSequence}</td>
                        <td className="px-4 py-2 text-right text-slate-600">
                          {item.quantityShipped}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-900">
                          {item.quantityAffected}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600">
                          {formatClaimAmount(item.declaredUnitValueMinor * item.quantityAffected)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <ClaimEvidencePanel
            claimId={claimId}
            checklist={checklist}
            documents={documents}
            audience="staff"
            readOnly
            onChanged={() => void load()}
          />

          {canReviewDocuments && documents.some((entry) => entry.reviewState === "PENDING") ? (
            <section className="rounded-2xl border border-slate-200 bg-white">
              <header className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  Documents awaiting review
                </h2>
              </header>
              <ul className="divide-y divide-slate-100">
                {documents
                  .filter((entry) => entry.reviewState === "PENDING")
                  .map((document) => (
                    <li
                      key={document._id}
                      className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                    >
                      <button
                        type="button"
                        onClick={() => void openClaimDocument("staff", claimId, document._id)}
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-blue-900 hover:underline"
                      >
                        {document.originalName}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              reviewClaimDocument(claimId, document._id, { decision: "ACCEPTED" }),
                            "Document accepted."
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        <FiCheck /> Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setDialog({
                            title: "Reject this document",
                            description: `${document.originalName}- the reason is shown to the client so they know what to send instead.`,
                            confirmLabel: "Reject it",
                            tone: "danger",
                            fields: [
                              {
                                kind: "textarea",
                                name: "reason",
                                label: "What is wrong with it?",
                                placeholder: "e.g. The invoice is unreadable- please send a clearer scan."
                              }
                            ],
                            onConfirm: (values) =>
                              run(
                                () =>
                                  reviewClaimDocument(claimId, document._id, {
                                    decision: "REJECTED",
                                    reason: values.reason
                                  }),
                                "Document rejected."
                              )
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        <FiX /> Reject
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

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
                      entry.visibility === "INTERNAL"
                        ? "border-slate-300 bg-slate-100"
                        : entry.authorKind === "CLIENT"
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      {entry.authorKind === "CLIENT" ? "Client" : "Swiftline"}
                      {entry.visibility === "INTERNAL" ? " · Internal" : ""} ·{" "}
                      {formatDashboardDateTime(entry.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-800">{entry.body}</p>
                  </div>
                ))
              )}
            </div>

            {canMessage ? (
              <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Reply to the client"
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void run(
                      () => postClaimMessage("staff", claimId, note),
                      "Message sent."
                    ).then(() => setNote(""))
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  <FiSend />
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Timeline and audit
              </h2>
            </header>
            <ol className="divide-y divide-slate-100">
              {events.map((entry) => (
                <li key={entry._id} className="px-5 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {claimLabel(entry.type)}
                    <span className="ml-2 text-xs font-normal uppercase text-slate-400">
                      {entry.actorKind.toLowerCase()}
                    </span>
                  </p>
                  {entry.reason ? <p className="text-sm text-slate-600">{entry.reason}</p> : null}
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatDashboardDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-5">
          {latestDecision ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Decision {decisions.length > 1 ? `(revision ${latestDecision.revision})` : ""}
              </h2>
              <div className="mt-3">
                <ClaimOutcomeNote outcome={latestDecision.outcome} />
              </div>
              <p className="mt-3 text-sm text-slate-700">{latestDecision.customerExplanation}</p>
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Approved {formatClaimAmount(latestDecision.approvedAmountMinor)} of{" "}
                {formatClaimAmount(latestDecision.requestedAmountMinor)}
              </p>
              <button
                type="button"
                onClick={() => void openDecisionLetter("staff", claimId)}
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"
              >
                <FiFileText /> Open decision letter
              </button>
            </section>
          ) : null}

          {canDecide && data.availableActions.includes("DECIDE") ? (
            <ClaimDecisionPanel
              claimId={claimId}
              requestedAmountMinor={claim.requestedAmountMinor ?? 0}
              declaredValueMinor={declaredValueMinor}
              onDecided={() => void load()}
            />
          ) : null}

          <ClaimSettlementPanel
            claimId={claimId}
            approvedAmountMinor={claim.approvedAmountMinor}
            paidAmountMinor={claim.paidAmountMinor}
            beneficiary={data.beneficiary}
            beneficiaryId={data.beneficiary?._id ?? null}
            settlements={settlements}
            recoveries={recoveries}
            documents={documents}
            canPay={canPay}
            canManageRecovery={canPay}
            onChanged={() => void load()}
          />
        </div>
      </div>
    </div>
  );
}
