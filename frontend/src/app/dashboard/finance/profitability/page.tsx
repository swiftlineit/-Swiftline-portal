"use client";

import { useEffect, useState } from "react";
import { DashboardLoading } from "@/components/DashboardShell";
import BuyingRatesPanel from "@/components/profitability/BuyingRatesPanel";
import FlightCostsPanel from "@/components/profitability/FlightCostsPanel";
import ProfitabilityOverviewPanel from "@/components/profitability/ProfitabilityOverviewPanel";
import ProfitabilitySelect from "@/components/profitability/ProfitabilitySelect";
import ShipmentMarginsTable from "@/components/profitability/ShipmentMarginsTable";
import { listBranches, type Branch } from "@/lib/branches";
import {
  getProfitabilityOverview,
  listProfitabilityShipments,
  listProfitabilityVendors,
  type LogisticsVendor,
  type ProfitabilityOverview,
  type ProfitabilityRow,
} from "@/lib/profitability";
import { FINANCE_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

type Tab = "OVERVIEW" | "FLIGHTS" | "SHIPMENTS" | "RATES";

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default function ProfitabilityPage() {
  const { user, loading } = useAdminUser(FINANCE_AREA);
  const today = indiaToday();

  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vendors, setVendors] = useState<LogisticsVendor[]>([]);
  const [overview, setOverview] = useState<ProfitabilityOverview | null>(null);
  const [rows, setRows] = useState<ProfitabilityRow[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pages: 1,
    total: 0,
  });

  const [branchId, setBranchId] = useState("");
  const [service, setService] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [coverage, setCoverage] = useState("");
  const [result, setResult] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [error, setError] = useState("");

  async function reloadVendors() {
    const response = await listProfitabilityVendors();
    setVendors(response.vendors);
  }

  useEffect(() => {
    if (!user) return;

    let active = true;

    Promise.all([
      listBranches("", "ACTIVE"),
      listProfitabilityVendors(),
    ])
      .then(([branchResult, vendorResult]) => {
        if (!active) return;

        setBranches(branchResult.branches);
        setVendors(vendorResult.vendors);
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Profitability could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const handle = window.setTimeout(
      () => setSearch(searchInput.trim()),
      300,
    );

    return () => window.clearTimeout(handle);
  }, [searchInput, user]);

  useEffect(() => {
    if (!user || dataLoading) return;

    let active = true;

    Promise.all([
      getProfitabilityOverview({
        branchId,
        service,
      }),
      listProfitabilityShipments({
        from,
        to,
        branchId,
        service,
        search,
        coverage,
        result,
        page: 1,
        limit: 25,
      }),
    ])
      .then(([overviewResult, shipmentResult]) => {
        if (!active) return;

        setOverview(overviewResult);
        setRows(shipmentResult.rows);

        setPagination({
          page: shipmentResult.pagination.page,
          pages: shipmentResult.pagination.pages,
          total: shipmentResult.pagination.total,
        });

        setError("");
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Profitability could not be refreshed.",
          );
        }
      })
      .finally(() => {
        if (active) setReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    branchId,
    coverage,
    dataLoading,
    from,
    result,
    search,
    service,
    to,
    user,
  ]);

  async function loadPage(page: number) {
    const response = await listProfitabilityShipments({
      from,
      to,
      branchId,
      service,
      search,
      coverage,
      result,
      page,
      limit: 25,
    });

    setRows(response.rows);

    setPagination({
      page: response.pagination.page,
      pages: response.pagination.pages,
      total: response.pagination.total,
    });
  }

  if (loading || !user) return <DashboardLoading />;

  const showReportingFilters =
    tab === "OVERVIEW" || tab === "SHIPMENTS";

  return (
    <div className="mx-auto max-w-8xl space-y-5">
      <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0D1282]">
              Finance
            </p>

            <h1 className="mt-0.5 text-xl font-bold text-slate-950 sm:text-2xl">
              Profitability / Margin
            </h1>
          </div>

          <nav
            className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 lg:w-auto lg:shrink-0"
            aria-label="Profitability sections"
          >
            {(
              [
                {
                  id: "OVERVIEW",
                  label: "Overview",
                },
                {
                  id: "FLIGHTS",
                  label: "Flight costs",
                },
                {
                  id: "SHIPMENTS",
                  label: "Shipment margins",
                },
                {
                  id: "RATES",
                  label: "Buying rates",
                },
              ] as Array<{
                id: Tab;
                label: string;
              }>
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition sm:flex-none sm:px-4 ${
                  tab === item.id
                    ? "bg-[#0D1282] text-white shadow-sm"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {tab !== "RATES" ? (
          <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-56">
                Branch

                <ProfitabilitySelect
                  value={branchId}
                  onChange={(event) =>
                    setBranchId(event.target.value)
                  }
                  className="mt-2"
                >
                  <option value="">
                    All accessible branches
                  </option>

                  {branches.map((branch) => (
                    <option
                      key={branch._id}
                      value={branch._id}
                    >
                      {branch.name} ({branch.code})
                    </option>
                  ))}
                </ProfitabilitySelect>
              </label>

              {showReportingFilters ? (
                <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-44">
                  Service

                  <ProfitabilitySelect
                    value={service}
                    onChange={(event) =>
                      setService(event.target.value)
                    }
                    className="mt-2"
                  >
                    <option value="">All services</option>
                    <option value="COURIER">
                      Courier
                    </option>
                    <option value="CARGO">
                      Cargo
                    </option>
                  </ProfitabilitySelect>
                </label>
              ) : null}

              {tab === "SHIPMENTS" ? (
                <>
                  <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-40">
                    From

                    <input
                      type="date"
                      value={from}
                      max={to}
                      onChange={(event) =>
                        setFrom(event.target.value)
                      }
                      className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0D1282]"
                    />
                  </label>

                  <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-40">
                    To

                    <input
                      type="date"
                      value={to}
                      min={from}
                      max={today}
                      onChange={(event) =>
                        setTo(event.target.value)
                      }
                      className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0D1282]"
                    />
                  </label>

                  <label className="w-full min-w-0 text-sm font-semibold text-slate-700 lg:min-w-56 lg:flex-1">
                    Search

                    <input
                      value={searchInput}
                      onChange={(event) =>
                        setSearchInput(event.target.value)
                      }
                      placeholder="AWB, customer or destination"
                      className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0D1282]"
                    />
                  </label>

                  <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-40">
                    Coverage

                    <ProfitabilitySelect
                      value={coverage}
                      onChange={(event) =>
                        setCoverage(event.target.value)
                      }
                      className="mt-2"
                    >
                      <option value="">All</option>
                      <option value="ACTUAL">
                        Actual
                      </option>
                      <option value="ESTIMATED">
                        Provisional
                      </option>
                      <option value="PARTIAL">
                        Partial
                      </option>
                      <option value="MISSING">
                        Missing
                      </option>
                    </ProfitabilitySelect>
                  </label>

                  <label className="w-full text-sm font-semibold text-slate-700 sm:w-[calc(50%-0.375rem)] lg:w-36">
                    Result

                    <ProfitabilitySelect
                      value={result}
                      onChange={(event) =>
                        setResult(event.target.value)
                      }
                      className="mt-2"
                    >
                      <option value="">All</option>
                      <option value="PROFIT">
                        Profit
                      </option>
                      <option value="LOSS">
                        Loss
                      </option>
                    </ProfitabilitySelect>
                  </label>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {dataLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          Loading profitability…
        </div>
      ) : null}

      {!dataLoading &&
      tab === "OVERVIEW" &&
      reportLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          Loading overview…
        </div>
      ) : null}

      {!dataLoading &&
      tab === "OVERVIEW" &&
      !reportLoading &&
      overview ? (
        <ProfitabilityOverviewPanel
          overview={overview}
        />
      ) : null}

      {!dataLoading && tab === "FLIGHTS" ? (
        <FlightCostsPanel branchId={branchId} canDeleteDrafts={user.role === "admin" || user.role === "operations"} />
      ) : null}

      {!dataLoading && tab === "SHIPMENTS" ? (
        <ShipmentMarginsTable
          rows={rows}
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          onPage={(page) => void loadPage(page)}
        />
      ) : null}

      {!dataLoading && tab === "RATES" ? (
        <BuyingRatesPanel
          vendors={vendors}
          reloadVendors={reloadVendors}
        />
      ) : null}
    </div>
  );
}
