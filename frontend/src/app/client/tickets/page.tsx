"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  FiPlus,
  FiSearch,
  FiChevronDown,
  FiClock,
  FiMail,
  FiMessageCircle,
  FiPhone,
  FiShield,
  FiPhoneCall,
} from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import {
  ClientDashboardLoading,
} from "@/components/client/ClientDashboardShell";
import TicketTable from "@/components/tickets/TicketTable";
import {
  listSupportTickets,
  ticketCategories,
  type SupportTicket,
} from "@/lib/supportTickets";
import { useClientUser } from "@/lib/useClientUser";

// Swiftline customer care contact points, kept together so they are changed once.
const WHATSAPP_NUMBER = "917027606600";
const WHATSAPP_MESSAGE =
  "Hello Swiftline, I need help with my shipment. My business account is ";
const SUPPORT_PHONES = [
  "+91 70276 06600",
  "+91 70271 18800",
  "+91 70155 07349",
];
const SUPPORT_EMAILS = [
  "info@swiftlinefreight.com",
  "operations@swiftlineindia.com",
  "director@swiftlineindia.com",
];
const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

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

        {/* What every Swiftline customer gets, with WhatsApp as the fastest route. */}
        <div className="mb-5 grid gap-4 md:grid-cols-3">
          <Perk
            icon={<FiClock className="h-5 w-5" />}
            title="24/7 Support"
            description="Our customer care team is available 24/7 to assist with shipment bookings, tracking, billing, and any questions, ensuring you receive prompt and reliable support whenever you need it."
          />
          <Perk
            icon={<FiMessageCircle className="h-5 w-5" />}
            title="Chat With Us"
            description="Message us on WhatsApp to connect directly with our support team for quick assistance and shipment-related queries."
            action={
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-4xl bg-[#25D366] px-4 text-sm font-semibold text-white transition hover:bg-[#1eb455]"
              >
                <FaWhatsapp className="h-4 w-4" />
                Chat on WhatsApp
              </a>
            }
          />
          <Perk
            icon={<FiPhoneCall className="h-5 w-5" />}
            title="Contact Information"
            description={
              <div className="flex flex-row gap-10 space-y-4 text-sm leading-6 text-slate-600">
                <div>
                  {/* <p className="font-semibold text-slate-900">Phone</p> */}
                  <div className="mt-1 space-y-1">
                    <p>+91 70276 06600</p>
                    <p>+91 70271 18800</p>
                    <p>+91 70155 07349</p>
                  </div>
                </div>

                <div>
                  {/* <p className="font-semibold text-slate-900">Email</p> */}
                  <div className="mt-1 space-y-1 break-all">
                    <p>info@swiftlinefreight.com</p>
                    <p>operations@swiftlineindia.com</p>
                    <p>director@swiftlineindia.com</p>
                  </div>
                </div>
              </div>
            }
          />
        </div>

        {/* Direct lines for customers who would rather not raise a ticket. */}

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
              {[
                "OPEN",
                "IN_PROGRESS",
                "WAITING_FOR_CUSTOMER",
                "RESOLVED",
                "CLOSED",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
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

/** One customer-service benefit tile, with an optional call to action. */
function Perk({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-xl">
      <div className="bg-linear-to-r from-blue-400 via-blue-300 to-blue-300 p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl text-slate-900 shadow-sm">
          {icon}
        </div>
      </div>

      <div className="p-6">
        <h3 className="text-lg font-semibold tracking-wide text-slate-900">{title}</h3>

        <div className="mt-2 text-sm leading-6 text-slate-500">
          {description}
        </div>

        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

/** A labelled list of tappable phone numbers or email addresses. */

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
