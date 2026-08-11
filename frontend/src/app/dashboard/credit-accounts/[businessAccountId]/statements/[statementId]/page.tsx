"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FiDownload, FiPrinter, FiRefreshCw } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import {
  getAdminStatement,
  openAuthenticatedFile,
  printAuthenticatedPdf,
  type CreditStatement,
} from "@/lib/creditBilling";
import { formatDashboardDate } from "@/lib/dateFormat";
import { CREDIT_VIEW_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

function money(valueMinor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(valueMinor / 100);
}

export default function AdminCreditStatementDetailPage() {
  const { user, loading: userLoading } = useAdminUser(CREDIT_VIEW_AREA);
  const params = useParams<{
    businessAccountId: string;
    statementId: string;
  }>();
  const [statement, setStatement] = useState<CreditStatement | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void getAdminStatement(params.businessAccountId, params.statementId)
      .then((result) => setStatement(result.statement))
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Statement could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, [params.businessAccountId, params.statementId, user]);

  if (userLoading || !user) return <DashboardLoading />;
  const pdfPath = `/api/v1/credit-accounts/${params.businessAccountId}/statements/${params.statementId}/pdf`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/credit-accounts/${params.businessAccountId}`}
            className="text-sm font-semibold text-blue-900"
          >
            Back to credit account
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">
            {statement?.statementNumber || "Credit Statement"}
          </h1>
          {statement ? (
            <p className="mt-1 text-sm text-slate-600">
              {formatDashboardDate(statement.periodStart)} to{" "}
              {formatDashboardDate(
                new Date(
                  new Date(statement.periodEnd).getTime() - 1,
                ).toISOString(),
              )}
            </p>
          ) : null}
        </div>
        {statement ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void openAuthenticatedFile(pdfPath)}
              className="h-10 border border-slate-300 px-4 text-sm rounded-4xl font-semibold text-blue-900"
            >
              View
            </button>
            <button
              type="button"
              onClick={() =>
                void openAuthenticatedFile(
                  `${pdfPath}?download=1`,
                  `${statement.statementNumber.replaceAll("/", "-")}.pdf`,
                )
              }
              className="inline-flex h-10 items-center gap-2 border rounded-4xl border-slate-300 px-4 text-sm font-semibold text-blue-900"
            >
              <FiDownload /> Download
            </button>
            <button
              type="button"
              onClick={() => void printAuthenticatedPdf(pdfPath)}
              className="inline-flex h-10 items-center gap-2 border rounded-4xl border-slate-300 px-4 text-sm font-semibold text-blue-900"
            >
              <FiPrinter /> Print
            </button>
          </div>
        ) : null}
      </div>
      {error ? (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-500">
          <FiRefreshCw className="mr-2 inline animate-spin" />
          Loading statement...
        </div>
      ) : null}
      {statement ? (
        <>
          <section className="grid border border-slate-200 bg-white rounded-2xl sm:grid-cols-2 lg:grid-cols-5">
            <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Issued
              </p>
              <p className="mt-2 font-semibold">
                {formatDashboardDate(statement.issuedAt)}
              </p>
            </div>
            <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Due
              </p>
              <p className="mt-2 font-semibold">
                {formatDashboardDate(statement.dueAt)}
              </p>
            </div>
            <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Total
              </p>
              <p className="mt-2 font-semibold">
                {money(statement.totalAmountMinor)}
              </p>
            </div>
            <div className="border-b border-slate-200 p-5 sm:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Settled
              </p>
              <p className="mt-2 font-semibold">
                {money(
                  statement.paidAmountMinor + statement.creditAdjustmentMinor,
                )}
              </p>
            </div>
            <div className="bg-blue-950 p-5 text-white">
              <p className="text-xs font-semibold uppercase text-blue-200">
                Outstanding
              </p>
              <p className="mt-2 text-xl font-semibold">
                {money(statement.outstandingAmountMinor)}
              </p>
            </div>
          </section>
          {statement.adjustments.length ? (
            <section className="overflow-x-auto border border-slate-200 bg-white rounded-2xl" >
              <div className="border-b border-slate-200 p-5">
                <h2 className="font-semibold">Billing Adjustments</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Approved shipment updates linked to previously issued
                  statements.
                </p>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.adjustments.map((adjustment) => (
                    <tr
                      key={adjustment.adjustmentId}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-4">{adjustment.description}</td>
                      <td
                        className={`px-4 py-4 text-right font-semibold ${adjustment.amountMinor < 0 ? "text-emerald-700" : ""}`}
                      >
                        {adjustment.amountMinor > 0 ? "+" : ""}
                        {money(adjustment.amountMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <section className="overflow-x-auto border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-semibold">Billing Documents</h2>
              <p className="mt-1 text-sm text-slate-500">
                Shipment invoices included in this non-tax collection
                statement.
              </p>
            </div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3 text-center">Revision</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr
                    key={
                      line.shipmentInvoiceId ?? line.cancellationFeeInvoiceId
                    }
                    className="border-t border-slate-100"
                  >
                    <td className="px-4 py-4 font-semibold">
                      {line.invoiceNumber}
                    </td>
                    <td className="px-4 py-4">
                      {formatDashboardDate(line.invoiceIssuedAt)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {line.sourceType === "SHIPMENT_INVOICE"
                        ? line.invoiceRevision
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold">
                      {money(line.outstandingAmountMinor)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={
                          line.sourceType === "SHIPMENT_INVOICE"
                            ? `/dashboard/shipments/${line.shipmentDraftId}/invoice`
                            : `/dashboard/shipments/${line.shipmentDraftId}`
                        }
                        className="font-semibold text-blue-900"
                      >
                        {line.sourceType === "SHIPMENT_INVOICE"
                          ? "View Invoice"
                          : "View Cancellation"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
