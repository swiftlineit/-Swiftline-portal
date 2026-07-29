"use client";

import Link from "next/link";
import { FiClipboard, FiCreditCard, FiDollarSign, FiFileText, FiHelpCircle, FiPackage, FiTruck } from "react-icons/fi";
import type { ClientDashboardAccount } from "@/lib/clientDashboard";
import { panelLift, panelSurface } from "@/components/dashboard/DashboardWidgets";
import { canCreateShipment, canMakePayment, canRequestQuote, hasQuoteAccess } from "@/components/client/dashboard/clientDashboardPermissions";

export default function ClientQuickAccess({ account }: { account: ClientDashboardAccount }) {
  const financialAccess = canMakePayment(account);
  const quickAccess = [
    { label: "Create Shipment", description: "Upload an invoice and prepare a shipment draft", href: "/client/dpd-labels", icon: FiPackage, show: canCreateShipment(account) },
    { label: "Get Live Quote", description: "Estimate a rate before you commit", href: "/client/get-quote", icon: FiClipboard, show: canRequestQuote(account) },
    { label: "My Quotes", description: "Review priced quotes and convert them", href: "/client/quotes", icon: FiFileText, show: hasQuoteAccess(account) },
    { label: "Tracking", description: "Follow any shipment to its destination", href: "/client/tracking", icon: FiTruck, show: true },
    { label: "Support Tickets", description: "Message our team about a shipment", href: "/client/tickets", icon: FiHelpCircle, show: true },
    { label: "Credit Account", description: "View your facility and request a limit", href: "/client/credit", icon: FiDollarSign, show: true },
    { label: "Credit Statements", description: "Billing cycles and payment history", href: "/client/credit/statements", icon: FiFileText, show: financialAccess },
    { label: "Payments", description: "Add Customer Advance for bookings", href: "/client/payments", icon: FiCreditCard, show: financialAccess }
  ].filter((item) => item.show);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Quick access</h2>
        <p className="text-xs text-slate-500">Available for your role on this account</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {quickAccess.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-start gap-3 p-4 ${panelSurface} ${panelLift} focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#0D1282] transition group-hover:bg-[#0D1282] group-hover:text-white">
              <item.icon aria-hidden="true" className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
