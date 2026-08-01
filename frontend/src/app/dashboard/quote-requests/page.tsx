"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiPlus, FiRefreshCw, FiChevronDown } from "react-icons/fi";

import { DashboardLoading } from "@/components/DashboardShell";
import DateFilterInput from "@/components/ui/DateFilterInput";
import Pagination from "@/components/ui/Pagination";
import QuoteList from "@/components/quotes/QuoteList";
import {
  listShipmentQuotes,
  type QuoteStatus,
  type ShipmentQuote,
} from "@/lib/shipmentQuotes";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

const emptyPagination = { page: 1, limit: 20, total: 0, totalPages: 1 };

export default function AdminQuoteRequestsPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const [quotes, setQuotes] = useState<ShipmentQuote[]>([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [status, setStatus] = useState<"" | QuoteStatus>("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true);
    setError("");
    try {
      const result = await listShipmentQuotes("admin", { status, date, page });
      setQuotes(result.quotes);
      setPagination(result.pagination);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load quote requests.",
      );
    } finally {
      setDataLoading(false);
    }
  }, [status, date, page]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [load, user]);
  if (loading || !user) return <DashboardLoading />;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Quote Requests
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Review customer requests and publish valid Swiftline pricing.
          </p>
        </div>
        <div className="flex gap-2">
          <DateFilterInput
            value={date}
            onChange={(value) => {
              setDate(value);
              setPage(1);
            }}
          />

          <div className="relative inline-block">
  <select
    value={status}
    onChange={(event) => {
      setStatus(event.target.value as typeof status);
      setPage(1);
    }}
    className="h-10 appearance-none border border-slate-300 bg-white px-3 pr-10 text-sm font-semibold text-slate-700"
  >
    <option value="">All Status</option>
    {[
      "REQUESTED",
      "UNDER_REVIEW",
      "QUOTED",
      "DECLINED",
      "EXPIRED",
      "CONVERTED",
    ].map((item) => (
      <option key={item} value={item}>
        {item.replaceAll("_", " ")}
      </option>
    ))}
  </select>

  <FiChevronDown
    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
  />
</div>
          <button
            type="button"
            onClick={() => void load()}
            title="Refresh quotes"
            className="flex h-10 w-10 items-center justify-center border border-slate-300 bg-white text-blue-900"
          >
            <FiRefreshCw className={dataLoading ? "animate-spin" : ""} />
          </button>
          <Link
            href="/dashboard/quote-requests/new"
            className="inline-flex h-10 items-center rounded-4xl gap-2 bg-blue-950 px-4 text-sm font-semibold text-white"
          >
            <FiPlus />
            Create Quote
          </Link>
        </div>
      </div>
      {error ? (
        <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      <QuoteList quotes={quotes} audience="admin" loading={dataLoading} />
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={setPage}
      />
    </div>
  );
}
