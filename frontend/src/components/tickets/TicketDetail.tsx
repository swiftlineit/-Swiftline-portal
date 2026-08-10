"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiMessageSquare, FiSend, FiShield, FiUser } from "react-icons/fi";
import { IoMdSend } from "react-icons/io";
import { toast } from "react-toastify";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import {
  getSupportTicket,
  getSupportTicketContext,
  replySupportTicket,
  shipmentIssueCategories,
  ticketLabel,
  updateSupportTicket,
  type SupportTicket,
  type TicketAudience,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/supportTickets";
import { TicketPriorityBadge, TicketStatusBadge } from "./TicketStatusBadge";

export default function TicketDetail({
  audience,
  ticketId,
}: {
  audience: TicketAudience;
  ticketId: string;
}) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [admins, setAdmins] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState<TicketStatus>("OPEN");
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [assignedTo, setAssignedTo] = useState("");
  const [statusNote, setStatusNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ticketResult, context] = await Promise.all([
        getSupportTicket(audience, ticketId),
        audience === "admin"
          ? getSupportTicketContext()
          : Promise.resolve({ admins: [] }),
      ]);
      setTicket(ticketResult.ticket);
      setStatus(ticketResult.ticket.status);
      setPriority(ticketResult.ticket.priority);
      setAssignedTo(ticketResult.ticket.assignedTo || "");
      setAdmins(context.admins);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The support ticket could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [audience, ticketId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // A resolved ticket accepts two more customer replies before it locks. Swiftline
  // is never capped, so the customer's last question can always be answered.
  const allowance =
    audience === "client" ? (ticket?.resolvedReplyAllowance ?? null) : null;
  const repliesLeft = allowance ? Math.max(0, allowance.max - allowance.used) : null;
  const replyLimitReached = repliesLeft === 0;

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await replySupportTicket(
        audience,
        ticketId,
        reply,
        internal,
      );
      setTicket(result.ticket);
      setReply("");
      setInternal(false);
      toast.success(result.message);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The reply could not be sent.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdminChanges() {
    setBusy(true);
    setError("");
    try {
      const result = await updateSupportTicket(ticketId, {
        status,
        priority,
        assignedTo: assignedTo || null,
        note: statusNote,
      });
      setTicket(result.ticket);
      setStatusNote("");
      toast.success("Ticket updated.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The ticket could not be updated.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="flex align-middle justify-center  p-10 text-center text-sm font-semibold text-slate-500">
        Loading support ticket...
      </div>
    );
  if (!ticket)
    return (
      <div className="border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
        {error || "Ticket not found."}
      </div>
    );

  // Loss and damage categories are the ones a claim can follow from. A billing
  // query or an access problem has nothing to compensate.
  const claimableCategories = shipmentIssueCategories;

  const shipmentHref = ticket.relatedShipmentDraftId
    ? audience === "client"
      ? `/client/shipments/${ticket.relatedShipmentDraftId}`
      : `/dashboard/shipments/${ticket.relatedShipmentDraftId}`
    : "";
  return (
    <div className="space-y-5">
      {error ? (
        <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      <section className="border border-slate-200 bg-white rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {ticket.ticketNumber}
            </p>
            <h1 className="mt-2 text-xl font-semibold  tracking-wide text-red-500">
              {ticket.subject}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Raised by {ticket.creator?.name || "Client"} on{" "}
              {formatDashboardDateTime(ticket.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <TicketPriorityBadge priority={ticket.priority} />
            <TicketStatusBadge status={ticket.status} />
          </div>
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <Meta
            label="Customer"
            value={
              ticket.account
                ? `${ticket.account.companyName} (${ticket.account.accountId})`
                : "Unavailable"
            }
          />
          <Meta
            label="Branch"
            value={
              ticket.branch
                ? `${ticket.branch.name} (${ticket.branch.code})`
                : "Unavailable"
            }
          />
          <Meta label="Category" value={ticketLabel(ticket.category)} />
          <Meta
            label="Assigned To"
            value={ticket.assignee?.name || "Unassigned"}
          />
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section id="ticket-conversation" className="border border-slate-300 bg-white rounded-2xl  ">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-950">
              <FiMessageSquare />
              Conversation
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Messages are retained as part of the ticket history.
            </p>
          </div>
          <div className="space-y-4 p-5">
            {ticket.messages.map((message) => (
              <article
                key={message.id}
                className={`border p-4 rounded-xl ${message.internal ? "border-amber-200 bg-amber-50" : message.authorType === "ADMIN" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3 ">
                  <div className="flex items-center gap-2 ">
                    <FiUser className="text-slate-500" />
                    <p className="text-sm font-semibold tracking-wide text-slate-950">
                      {message.authorName}
                    </p>
                    {message.internal ? (
                      <span className="border border-amber-300 rounded-4xl px-2 py-0.5 text-xs font-semibold uppercase text-amber-800">
                        Internal Note
                      </span>
                    ) : null}
                  </div>
                  <time className="whitespace-nowrap text-xs text-slate-500">
                    {formatDashboardDateTime(message.createdAt)}
                  </time>
                </div> 
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6  text-slate-700">
                  {message.message}
                </p>
              </article>
            ))}
          </div>
          {audience === "client" && ticket.status === "CLOSED" ? (
            <div className="border-t border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              This ticket is closed. Raise a new ticket if you need further
              assistance.
            </div>
          ) : replyLimitReached ? (
            <div className="border-t border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              This ticket is resolved and you have used both follow-up replies.
              Raise a new ticket if you still need help.
            </div>
          ) : (
            <div className="border-t border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold uppercase text-slate-600">
                  {internal ? "Internal Note" : "Reply"}
                </label>
                {repliesLeft !== null ? (
                  <span className="text-xs font-semibold text-amber-700">
                    {repliesLeft} follow-up{repliesLeft === 1 ? "" : "s"} left on
                    this resolved ticket
                  </span>
                ) : null}
              </div>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={5}
                maxLength={2000}
                placeholder={
                  internal
                    ? "Visible only to Swiftline administrators"
                    : "Write a clear response"
                }
                className="mt-2 w-full resize-y border rounded-xl border-slate-300 p-3 text-sm focus:border-blue-900 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                {audience === "admin" ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(event) => setInternal(event.target.checked)}
                    />
                    Internal note
                  </label>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={busy || !reply.trim()}
                  onClick={() => void sendReply()}
                  className="inline-flex h-10 items-center rounded-4xl gap-2 bg-blue-950 px-4 text-sm font-semibold text-white disabled:bg-slate-400"
                >
                  
                  Send
                  <IoMdSend  />
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          {audience === "admin" ? (
            <section className="border border-slate-200 bg-white rounded-2xl">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-950">Manage Ticket</h2>
              </div>
              <div className="space-y-4 p-5">
                <Control label="Status">
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as TicketStatus)
                    }
                    className="h-10 w-full border rounded-xl border-slate-300 bg-white px-3 pr-9 text-sm"
                  >
                    {[
                      "OPEN",
                      "IN_PROGRESS",
                      "WAITING_FOR_CUSTOMER",
                      "RESOLVED",
                      "CLOSED",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {ticketLabel(value)}
                      </option>
                    ))}
                  </select>
                </Control>
                <Control label="Priority">
                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value as TicketPriority)
                    }
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 pr-9 text-sm"
                  >
                    {["LOW", "NORMAL", "HIGH", "URGENT"].map((value) => (
                      <option key={value} value={value}>
                        {ticketLabel(value)}
                      </option>
                    ))}
                  </select>
                </Control>
                <Control label="Assigned To">
                  <select
                    value={assignedTo}
                    onChange={(event) => setAssignedTo(event.target.value)}
                    className="h-10 w-full border rounded-xl border-slate-300 bg-white px-3 pr-9 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {admins.map((admin) => (
                      <option key={admin.id} value={admin.id}>
                        {admin.name}
                      </option>
                    ))}
                  </select>
                </Control>
                <Control label="Update Note">
                  <textarea
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={
                      ticket.status === "CLOSED" && status === "IN_PROGRESS"
                        ? "Reason for reopening"
                        : "Optional progress note"
                    }
                    className="w-full resize-y border rounded-xl border-slate-300 p-3 text-sm"
                  />
                </Control>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveAdminChanges()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 bg-blue-950 px-4 text-sm font-semibold rounded-4xl text-white disabled:bg-slate-400"
                >
                  {/* <FiCheck /> */}
                  Save Changes
                </button>
              </div>
            </section>
          ) : null}
          {shipmentHref ? (
            <section className="border border-slate-200 bg-white p-5 rounded-2xl">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Related Shipment
              </p>
              <Link
                href={shipmentHref}
                className="mt-3 inline-flex font-semibold text-blue-900 hover:text-blue-700"
              >
                Open shipment details
              </Link>

              {/*
                Offered only on the client's own view, and only for the loss and
                damage categories. A ticket is an enquiry; a claim asks for money.
                Raising one does not close the ticket — the two run in parallel
                and can end differently.
              */}
              {audience === "client" && claimableCategories.includes(ticket.category) ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="text-sm text-slate-600">
                    Looking for compensation for this shipment?
                  </p>
                  <Link
                    href={`/client/claims/new?shipmentId=${ticket.relatedShipmentDraftId}&ticketId=${ticket.id}`}
                    className="mt-2 inline-flex items-center gap-2 rounded-4xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    <FiShield aria-hidden="true" className="h-4 w-4" />
                    Raise a claim
                  </Link>
                </div>
              ) : null}
            </section>
          ) : null}
          <section className="border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-950">Progress History</h2>
            </div>
            <ol className="space-y-4 p-5">
              {[...ticket.statusHistory].reverse().map((item, index) => (
                <li key={`${item.changedAt}-${index}`}>
                  <p className="text-sm font-semibold text-slate-900">
                    {ticketLabel(item.toStatus)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDashboardDateTime(item.changedAt)}
                  </p>
                  {item.note ? (
                    <p className="mt-1 text-sm text-slate-600">{item.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-5 py-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold tracking-wide text-slate-600">
        {value}
      </p>
    </div>
  );
}
function Control({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-slate-600">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
