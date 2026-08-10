"use client";

import { useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiTag } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import {
  formatCountryRateService,
  getCountryFlag,
  listClientCountryRateCards,
  type ClientCountryRateCard,
  type ClientCountryRouteCharge,
} from "@/lib/countryRateCards";
import { useClientUser } from "@/lib/useClientUser";
import { getClientDashboard } from "@/lib/clientDashboard";
import CountryFlag from "@/components/CountryFlag";

export default function ClientRateCardPage() {
  const { user, loading: userLoading } = useClientUser();
  const [rates, setRates] = useState<ClientCountryRateCard[]>([]);
  const [routeCharges, setRouteCharges] = useState<ClientCountryRouteCharge[]>(
    [],
  );
  const [assigned, setAssigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userLoading || !user) return;
    let active = true;
    void getClientDashboard()
      .then((dashboard) => {
        const requestedAccountId = new URLSearchParams(
          window.location.search,
        ).get("businessAccountId");
        const account =
          dashboard.accounts.find(
            (item) => item.account.id === requestedAccountId,
          ) ?? dashboard.accounts[0];
        if (!account)
          throw new Error("Business account access is not available.");
        return listClientCountryRateCards(account.account.id);
      })
      .then((result) => {
        if (!active) return;
        setRates(result.rates);
        setRouteCharges(result.routeCharges);
        setAssigned(result.rateCardAssigned);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Your rate card could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, userLoading]);

  const charges = useMemo(
    () =>
      new Map(
        routeCharges.map((item) => [
          `${item.countryCode}:${item.service}`,
          item,
        ]),
      ),
    [routeCharges],
  );

  if (userLoading || !user) return <ClientDashboardLoading />;
  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-950">
          {/* <FiTag className="h-6 w-6 text-[#0D1282]" /> */}
          Your Swiftline Rate Card
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Your current destinations, weight slabs and applicable route charges.
        </p>
      </div>
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {!loading && !assigned ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <FiAlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              Shipment booking is paused for your account.
            </p>
            <p className="mt-1 text-sm">
              A rate card has not been assigned yet. Please contact Swiftline
              support.
            </p>
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-[#0D1282]">
          Loading your rate card...
        </div>
      ) : null}
      {!loading && assigned ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-200 text-xs uppercase text-slate-800">
              <tr>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Weight</th>
                <th className="px-4 py-3">Rate / KG</th>
                <th className="px-4 py-3">Max Box</th>
                <th className="px-4 py-3">Route Charges</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => {
                const route = charges.get(
                  `${rate.countryCode}:${rate.service}`,
                );
                const details = route
                  ? [
                      route.fuelSurchargePercent
                        ? `Fuel ${route.fuelSurchargePercent}%`
                        : "",
                      route.remoteAreaCharge
                        ? `Remote ₹${route.remoteAreaCharge}`
                        : "",
                      route.handlingCharge
                        ? `Handling ₹${route.handlingCharge}`
                        : "",
                      // Insurance is switched off portal-wide and never charged,
                      // so it is not quoted here.
                      route.discountPercent
                        ? `Discount ${route.discountPercent}%`
                        : "",
                    ].filter(Boolean)
                  : [];
                return (
                  <tr
                    key={rate._id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      <span className="mr-2  inline-block h-4 w-4">
                        {<CountryFlag code={rate.countryCode} className="mt-1" />}
                      </span>
                      {rate.countryName}
                    </td>
                    <td className="px-4 py-3">
                      {formatCountryRateService(rate.service)}
                    </td>
                    <td className="px-4 py-3">
                      {rate.fromKg}-{rate.toKg} kg
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      ₹{rate.chargesPerKg.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{rate.maxBoxKg} kg</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {details.join(" · ") || "No additional route charges"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && assigned && !rates.length ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          No destination rates are currently available on your assigned card.
          Pricing remains blocked for uncovered routes.
        </p>
      ) : null}
    </div>
  );
}
