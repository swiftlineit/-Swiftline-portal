"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiPlus, FiRefreshCw, FiSearch } from "react-icons/fi";
import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import TicketTable from "@/components/tickets/TicketTable";
import { listSupportTickets, ticketCategories, type SupportTicket } from "@/lib/supportTickets";
import { useClientUser } from "@/lib/useClientUser";

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
      const result = await listSupportTickets("client", { page, status, category, search });
      setTickets(result.tickets);
      setTotalPages(result.pagination.totalPages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Support tickets could not be loaded.");
    } finally {
      setDataLoading(false);
    }
  }, [category, page, search, status]);

  useEffect(() => { if (user) void Promise.resolve().then(load); }, [load, user]);
  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold text-slate-950">Support Tickets</h1><p className="mt-1 text-sm text-slate-500">Contact Swiftline and follow the progress of your requests.</p></div>
          <Link href="/client/tickets/new" className="inline-flex h-10 items-center gap-2 bg-blue-950 px-4 text-sm font-semibold text-white hover:bg-blue-900"><FiPlus />Raise Ticket</Link>
        </div>
        <div className="mb-5 grid gap-3 border border-slate-200 bg-white p-4 md:grid-cols-[minmax(220px,1fr)_220px_220px_auto]">
          <label className="relative"><span className="sr-only">Search tickets</span><FiSearch className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search ticket number or subject" className="h-10 w-full border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-900" /></label>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 pr-9 text-sm"><option value="">All statuses</option>{["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} className="h-10 border border-slate-300 bg-white px-3 pr-9 text-sm"><option value="">All categories</option>{ticketCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <button type="button" onClick={() => void load()} title="Refresh tickets" className="flex h-10 w-10 items-center justify-center border border-slate-300 text-blue-900"><FiRefreshCw className={dataLoading ? "animate-spin" : ""} /></button>
        </div>
        {error ? <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        <TicketTable tickets={tickets} audience="client" loading={dataLoading} />
        {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} onChange={setPage} /> : null}
      </div>
    </ClientDashboardShell>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return <div className="mt-4 flex items-center justify-end gap-3"><button disabled={page === 1} onClick={() => onChange(page - 1)} className="h-9 border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {page} of {totalPages}</span><button disabled={page === totalPages} onClick={() => onChange(page + 1)} className="h-9 border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40">Next</button></div>;
}
