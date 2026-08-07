import { readJsonSafely } from "@/lib/auth";
import { fetchWithAuth } from "@/lib/shipmentsList";

export type CounterSalePayment = {
  id: string;
  shipmentDraftId: string;
  trackingNumber: string;
  customerName: string;
  customerMobile: string;
  branch: { id: string; name: string; code: string } | null;
  direction: "COLLECTED" | "REFUNDED";
  amountMinor: number;
  method: "CASH" | "UPI" | "BANK_TRANSFER" | "CARD" | "CHEQUE";
  reference: string;
  note: string;
  recordedBy: string;
  recordedAt: string;
};

export type CounterSalesTotals = {
  collectedMinor: number;
  refundedMinor: number;
  netMinor: number;
};

/**
 * Walk-in takings. These never appear in the credit ledger: individual shipments
 * are paid in full before booking and hold no credit account.
 */
export async function listCounterSales(filters: {
  branchId?: string;
  from?: string;
  to?: string;
  direction?: "COLLECTED" | "REFUNDED" | "";
} = {}) {
  const query = new URLSearchParams();
  if (filters.branchId) query.set("branchId", filters.branchId);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.direction) query.set("direction", filters.direction);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetchWithAuth(`/api/v1/counter-sales${suffix}`);
  const data = await readJsonSafely(response) as {
    success?: boolean;
    message?: string;
    payments?: CounterSalePayment[];
    totals?: CounterSalesTotals;
  };

  if (!response.ok || !data.success) {
    throw new Error(data.message ?? "Counter sales could not be loaded.");
  }

  return {
    payments: data.payments ?? [],
    totals: data.totals ?? { collectedMinor: 0, refundedMinor: 0, netMinor: 0 }
  };
}
