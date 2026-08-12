import type { TicketPriority, TicketStatus } from "@/lib/supportTickets";
import { ticketLabel, ticketStatusLabels } from "@/lib/supportTickets";

/**
 * Tone groups the statuses by who is being waited on, not by position in the
 * queue: blue is with Swiftline, amber is with someone outside it, orange means
 * the customer has to act, green is finished.
 */
const statusTones: Record<TicketStatus, string> = {
  OPEN: "border-blue-200 bg-blue-50 text-blue-800",
  ASSIGNED: "border-blue-200 bg-blue-50 text-blue-800",
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-800",
  AWAITING_CARRIER: "border-violet-200 bg-violet-50 text-violet-800",
  WAITING_FOR_CUSTOMER: "border-orange-200 bg-orange-50 text-orange-800",
  // Louder than the other waiting states: nothing moves until the customer acts.
  ACTION_REQUIRED: "border-red-200 bg-red-50 text-red-700",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700"
};

const priorityTones: Record<TicketPriority, string> = {
  NORMAL: "border-blue-200 text-blue-700",
  URGENT: "border-amber-200 bg-amber-50 text-amber-800",
  CRITICAL: "border-red-200 bg-red-50 text-red-700"
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex border px-2.5 rounded-4xl py-1 text-xs font-semibold uppercase ${statusTones[status]}`}>
      {ticketStatusLabels[status]}
    </span>
  );
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`inline-flex border rounded-4xl px-2.5 py-1 text-xs font-semibold uppercase ${priorityTones[priority]}`}>
      {ticketLabel(priority)}
    </span>
  );
}
