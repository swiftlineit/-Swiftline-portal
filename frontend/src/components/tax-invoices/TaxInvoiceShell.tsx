"use client";

import Sidebar from "@/components/Sidebar";
import type { AuthenticatedUser } from "@/lib/useAdminUser";

export function TaxInvoiceLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-sm font-semibold text-slate-500">Loading tax invoice workspace...</p>
    </div>
  );
}

export default function TaxInvoiceShell({ user, children }: { user: AuthenticatedUser; children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar userRole={user.role} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
}
