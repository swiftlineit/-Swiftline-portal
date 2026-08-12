import Link from "next/link";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import type { SupportTicket, TicketAudience } from "@/lib/supportTickets";
import { ticketLabel } from "@/lib/supportTickets";
import { TicketPriorityBadge, TicketStatusBadge } from "./TicketStatusBadge";

export default function TicketTable({
  tickets,
  audience,
  loading,
}: {
  tickets: SupportTicket[];
  audience: TicketAudience;
  loading: boolean;
}) {
  if (loading)
    return (
      <div className="border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Loading support tickets...
      </div>
    );
  if (!tickets.length)
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="font-semibold text-slate-900">No support tickets yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Need help with a shipment, a delivery, customs, or billing? Raise a ticket and the
          Swiftline team will pick it up — you will see every reply here.
        </p>
        {audience === "client" ? (
          <Link
            href="/client/tickets/new"
            className="mt-5 inline-flex h-10 items-center rounded-4xl bg-blue-950 px-5 text-sm font-semibold text-white transition hover:bg-blue-900"
          >
            Raise Ticket
          </Link>
        ) : null}
      </div>
    );
  return (
    <div className="overflow-x-auto border border-slate-200 bg-white rounded-2xl">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
          <tr>
            <th className="px-4 py-3">Ticket</th>
            {audience === "admin" ? (
              <th className="px-4 py-3">Customer</th>
            ) : null}
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Category</th>
            {audience === "admin" ? (
              <th className="px-4 py-3">Priority</th>
            ) : null}
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-950">
                {ticket.ticketNumber}
              </td>
              {audience === "admin" ? (
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-900">
                    {ticket.account?.companyName || "Account unavailable"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {ticket.branch
                      ? `${ticket.branch.name} (${ticket.branch.code})`
                      : "Branch unavailable"}
                  </p>
                </td>
              ) : null}
              <td className="max-w-xs px-4 py-4">
                <p className="truncate font-semibold text-slate-900">
                  {ticket.subject}
                </p>
                {ticket.relatedShipmentDraftId ? (
                  <p className="mt-1 text-xs text-slate-500">Shipment linked</p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-700">
                {ticketLabel(ticket.category)}
              </td>
              {audience === "admin" ? (
                <td className="px-4 py-4">
                  <TicketPriorityBadge priority={ticket.priority} />
                </td>
              ) : null}
              <td className="px-4 py-4">
                <TicketStatusBadge status={ticket.status} />
                {/* The first-response clock. Only shown while it still means
                    something: a ticket already answered needs no countdown. */}
                {ticket.sla?.breached ? (
                  <span className="mt-1 block w-fit rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                    SLA exceeded
                  </span>
                ) : ticket.sla?.open ? (
                  <span className="mt-1 block text-[11px] text-slate-400">
                    Reply due {formatDashboardDateTime(ticket.sla.firstResponseDueAt)}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                {formatDashboardDateTime(ticket.lastMessageAt)}
              </td>
              <td className="px-4 py-4 text-right">
                <Link
                  href={`${audience === "client" ? "/client/tickets" : "/dashboard/tickets"}/${ticket.id}`}
                  className="font-semibold text-blue-900 hover:text-blue-700"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
