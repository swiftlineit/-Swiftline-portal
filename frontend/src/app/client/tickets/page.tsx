"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  FiPlus,
  FiSearch,
  FiChevronDown,
  FiMail,
  FiPhone,
} from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import {
  ClientDashboardLoading,
} from "@/components/client/ClientDashboardShell";
import TicketTable from "@/components/tickets/TicketTable";
import {
  listSupportTickets,
  ticketCategories,
  ticketStatuses,
  ticketStatusLabels,
  type SupportTicket,
} from "@/lib/supportTickets";
import { useClientUser } from "@/lib/useClientUser";

/**
 * Swiftline customer care, kept together so it is changed once.
 *
 * One number and one address are promoted; the rest sit behind a disclosure.
 * Three of each presented equally is not more helpful — it is a decision handed
 * to the customer. The director's address is deliberately absent: it was never
 * a support channel, and publishing it to every customer guarantees it becomes
 * one.
 */
const PRIMARY_PHONE = "+91 70276 06600";
const PRIMARY_EMAIL = "info@swiftlinefreight.com";
const WHATSAPP_NUMBER = "917027606600";
const OTHER_CONTACTS = [
  { label: "Alternate line", value: "+91 70271 18800", href: "tel:+917027118800" },
  { label: "Alternate line", value: "+91 70155 07349", href: "tel:+917015507349" },
  { label: "Operations", value: "operations@swiftlineindia.com", href: "mailto:operations@swiftlineindia.com" },
];

/**
 * Pre-fills the WhatsApp message with what support would otherwise have to ask
 * for. Opening an empty chat costs the customer a round trip and the agent a
 * lookup.
 */
function whatsappHref(context: { accountCode?: string; ticketNumber?: string; awb?: string }) {
  const lines = ["Hello Swiftline Support, I need assistance."];
  if (context.awb) lines.push(`AWB: ${context.awb}`);
  if (context.ticketNumber) lines.push(`Ticket Number: ${context.ticketNumber}`);
  if (context.accountCode) lines.push(`Account: ${context.accountCode}`);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export default function ClientTicketsPage() {
  const { user, loading } = useClientUser();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true);
    setError("");
    try {
      const result = await listSupportTickets("client", {
        page,
        status,
        category,
        search,
      });
      setTickets(result.tickets);
      setTotalPages(result.pagination.totalPages);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Support tickets could not be loaded.",
      );
    } finally {
      setDataLoading(false);
    }
  }, [category, page, search, status]);

  useEffect(() => {
    if (user) void Promise.resolve().then(load);
  }, [load, user]);

  // Counted over every ticket rather than the current page, so the cards
  // describe the queue and not whichever ten rows happen to be showing.
  const [allTickets, setAllTickets] = useState<SupportTicket[]>([]);
  useEffect(() => {
    if (!user) return;
    let active = true;

    listSupportTickets("client", { limit: 100 })
      .then((result) => { if (active) setAllTickets(result.tickets); })
      .catch(() => undefined);

    return () => { active = false; };
  }, [user]);

  const statusCards = [
    { status: "OPEN", label: "Open" },
    { status: "IN_PROGRESS", label: "Under Investigation" },
    { status: "WAITING_FOR_CUSTOMER", label: "Awaiting Customer" },
    { status: "AWAITING_CARRIER", label: "Awaiting Carrier" },
    { status: "RESOLVED", label: "Resolved" },
  ].map((card) => ({
    ...card,
    count: allTickets.filter((ticket) => ticket.status === card.status).length,
  }));

  if (loading || !user) return <ClientDashboardLoading />;

  return (
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Help-Desk</h1>
            <p className="mt-1 text-sm text-slate-500">
              Contact Swiftline and follow the progress of your requests.
            </p>
          </div>
          <Link
            href="/client/tickets/new"
            className="inline-flex rounded-4xl h-10  tracking-wide items-center gap-2 bg-blue-950 px-4 text-sm  text-white hover:bg-blue-900"
          >
            <FiPlus />
            Raise Ticket
          </Link>
        </div>

        {/* Where each ticket stands, so the queue is legible before it is read. */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statusCards.map((card) => (
            <button
              key={card.status}
              type="button"
              onClick={() => { setStatus(status === card.status ? "" : card.status); setPage(1); }}
              aria-pressed={status === card.status}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                status === card.status
                  ? "border-[#0D1282] bg-[#0D1282]/5"
                  : "border-slate-200 bg-white hover:border-[#0D1282]/40"
              }`}
            >
              <p className="text-xl font-semibold tabular-nums text-slate-900">{card.count}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {card.label}
              </p>
            </button>
          ))}
        </div>

        {/* One prominent way to reach Swiftline; the rest are one click away. */}
        <div className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Swiftline Customer Support
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-950">Available 24/7</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <a href={`tel:${PRIMARY_PHONE.replaceAll(" ", "")}`} className="flex items-center gap-2 font-medium text-slate-700 hover:text-[#0D1282]">
                <FiPhone aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {PRIMARY_PHONE}
              </a>
              <a href={`mailto:${PRIMARY_EMAIL}`} className="flex items-center gap-2 font-medium text-slate-700 hover:text-[#0D1282]">
                <FiMail aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {PRIMARY_EMAIL}
              </a>
            </div>

            <details className="mt-3 group">
              <summary className="cursor-pointer list-none text-xs font-semibold text-[#0D1282] hover:underline">
                Other contact options
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
                {OTHER_CONTACTS.map((contact) => (
                  <li key={contact.value}>
                    <span className="text-xs uppercase tracking-wide text-slate-400">{contact.label}</span>{" "}
                    <a href={contact.href} className="font-medium hover:text-[#0D1282]">{contact.value}</a>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <a
            href={whatsappHref({ accountCode: tickets[0]?.account?.accountId })}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-4xl bg-[#25D366] px-5 text-sm font-semibold text-white transition hover:bg-[#1eb455]"
          >
            <FaWhatsapp className="h-4 w-4" />
            Chat on WhatsApp
          </a>
        </div>

        <div className="mb-5 grid gap-3 border border-slate-200 bg-white rounded-2xl p-4 md:grid-cols-[minmax(220px,1fr)_220px_220px_auto]">
          <label className="relative">
            <span className="sr-only">Search tickets</span>
            <FiSearch className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search ticket number or subject"
              className="h-10 w-full border rounded-xl border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-900"
            />
          </label>
          <div className="relative">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-10 w-full appearance-none border border-slate-300 bg-white px-3 pr-9 rounded-xl text-sm"
            >
              <option value="">All Status</option>
              {ticketStatuses.map((value) => (
                <option key={value} value={value}>
                  {ticketStatusLabels[value]}
                </option>
              ))}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          <div className="relative">
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              className="h-10 w-full appearance-none border border-slate-300 rounded-xl bg-white px-3 pr-9 text-sm"
            >
              <option value="">All categories</option>
              {ticketCategories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          {/* <button
            type="button"
            onClick={() => void load()}
            title="Refresh tickets"
            className="flex h-10 w-10 items-center justify-center border border-slate-300 text-blue-900"
          >
            <FiRefreshCw className={dataLoading ? "animate-spin" : ""} />
          </button> */}
        </div>
        {error ? (
          <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}
        <TicketTable
          tickets={tickets}
          audience="client"
          loading={dataLoading}
        />
        {totalPages > 1 ? (
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        ) : null}
      </div>
  );
}


function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <button
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="h-9 border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-sm text-slate-600">
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className="h-9 border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
