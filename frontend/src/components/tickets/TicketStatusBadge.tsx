import type { TicketPriority, TicketStatus } from "@/lib/supportTickets";
import { ticketLabel } from "@/lib/supportTickets";

const statusTones: Record<TicketStatus, string> = {
  OPEN: "border-blue-200 bg-blue-50 text-blue-800",
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-800",
  WAITING_FOR_CUSTOMER: "border-orange-200 bg-orange-50 text-orange-800",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700"
};
const priorityTones: Record<TicketPriority, string> = {
  LOW: "border-slate-200 text-slate-600", NORMAL: "border-blue-200 text-blue-700",
  HIGH: "border-amber-200 text-amber-800", URGENT: "border-red-200 bg-red-50 text-red-700"
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`inline-flex border px-2.5 rounded-4xl py-1 text-xs font-semibold uppercase ${statusTones[status]}`}>{ticketLabel(status)}</span>;
}
export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={`inline-flex border rounded-4xl px-2.5 py-1 text-xs font-semibold uppercase ${priorityTones[priority]}`}>{ticketLabel(priority)}</span>;
}
