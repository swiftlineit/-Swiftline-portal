import { requestJson } from "@/lib/shipmentsList";

export const costComponents = [
  "FREIGHT_BUYING", "AIRLINE_VENDOR", "FUEL_SURCHARGE", "HANDLING",
  "CUSTOMS_CLEARANCE", "PICKUP", "DELIVERY", "OTHER"
] as const;
export type CostComponent = (typeof costComponents)[number];
export type CostCoverage = "MISSING" | "PARTIAL" | "ESTIMATED" | "ACTUAL";

export const costComponentLabels: Record<CostComponent, string> = {
  FREIGHT_BUYING: "Freight buying cost",
  AIRLINE_VENDOR: "Airline / vendor cost",
  FUEL_SURCHARGE: "Fuel surcharge",
  HANDLING: "Handling cost",
  CUSTOMS_CLEARANCE: "Customs / clearance cost",
  PICKUP: "Pickup cost",
  DELIVERY: "Delivery cost",
  OTHER: "Other cost"
};

export type ProfitabilityCost = {
  component: CostComponent;
  amountMinor: number;
  state: "MISSING" | "ESTIMATED" | "ACTUAL";
  source: "NONE" | "VENDOR_RATE" | "MANUAL";
  vendorId: string | null;
  rateId: string | null;
  reference: string;
  note: string;
  updatedAt: string | null;
};

export type ProfitabilityRow = {
  id: string;
  shipmentDraftId: string;
  branchId: string;
  businessAccountId: string;
  primaryVendor: { id: string; name: string; code: string } | null;
  awb: string;
  customerName: string;
  originCountryCode: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  serviceType: "COURIER" | "CARGO";
  serviceCode: string;
  chargeableWeightKg: number;
  bookedAt: string;
  currency: "INR";
  customerSellingAmountMinor: number;
  revenueAdjustmentMinor: number;
  totalRevenueMinor: number;
  dutyTaxMinor: number;
  costs: ProfitabilityCost[];
  totalCostMinor: number;
  grossProfitMinor: number;
  marginBasisPoints: number | null;
  coverage: CostCoverage;
  version: number;
  updatedAt: string;
};

export type ProfitabilityOverview = {
  currency: "INR";
  today: { revenueMinor: number; costMinor: number; profitMinor: number; marginBasisPoints: number | null };
  monthlyTrend: Array<{ date: string; revenueMinor: number; costMinor: number; profitMinor: number }>;
  lossMaking: ProfitabilityRow[];
  mostProfitableCustomers: Array<{ businessAccountId: string; customerName: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>;
  mostProfitableLanes: Array<{ originCountryCode: string; destinationCountryCode: string; destinationCountryName: string; serviceType: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>;
  coverage: Array<{ coverage: CostCoverage; count: number }>;
};

export type LogisticsVendor = {
  _id: string;
  name: string;
  code: string;
  type: "AIRLINE" | "CARRIER" | "FREIGHT_AGENT" | "CUSTOMS_BROKER" | "PICKUP_VENDOR" | "DELIVERY_VENDOR" | "OTHER";
  integrationCode: "" | "ALS_DPD";
  status: "ACTIVE" | "INACTIVE";
};

export type VendorCostRate = {
  _id: string;
  vendorId: LogisticsVendor;
  component: CostComponent;
  originCountryCode: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  service: "COURIER" | "CARGO";
  fromKg: number;
  toKg: number;
  calculation: "PER_KG" | "FLAT" | "PERCENT_OF_FREIGHT";
  amountMinor: number;
  percentageBasisPoints: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "RETIRED";
};

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getProfitabilityOverview(filters: { branchId?: string; service?: string } = {}) {
  return requestJson<{ success: true } & ProfitabilityOverview>(`/api/v1/profitability/overview${queryString(filters)}`);
}

export function listProfitabilityShipments(filters: { from: string; to: string; branchId?: string; service?: string; coverage?: string; result?: string; search?: string; page?: number; limit?: number }) {
  return requestJson<{ success: true; currency: "INR"; rows: ProfitabilityRow[]; pagination: { page: number; limit: number; total: number; pages: number } }>(`/api/v1/profitability/shipments${queryString(filters)}`);
}

export function updateProfitabilityCosts(shipmentDraftId: string, input: {
  expectedVersion: number;
  primaryVendorId: string | null;
  costs: Array<{ component: CostComponent; amountMinor: number | null; reference?: string; note?: string }>;
  reason: string;
}) {
  return requestJson<{ success: true; message: string; profitability: ProfitabilityRow }>(`/api/v1/profitability/shipments/${shipmentDraftId}/costs`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function listProfitabilityVendors() {
  return requestJson<{ success: true; vendors: LogisticsVendor[] }>("/api/v1/profitability/vendors");
}

export function createProfitabilityVendor(input: Pick<LogisticsVendor, "name" | "code" | "type" | "integrationCode">) {
  return requestJson<{ success: true; message: string; vendor: LogisticsVendor }>("/api/v1/profitability/vendors", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function updateProfitabilityVendorStatus(vendorId: string, status: LogisticsVendor["status"], reason: string) {
  return requestJson<{ success: true; message: string; vendor: LogisticsVendor }>(`/api/v1/profitability/vendors/${vendorId}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reason })
  });
}

export function listProfitabilityRates(vendorId = "") {
  return requestJson<{ success: true; rates: VendorCostRate[] }>(`/api/v1/profitability/vendor-rates${queryString({ vendorId })}`);
}

export function createProfitabilityRate(input: {
  vendorId: string; component: CostComponent; originCountryCode: string; destinationCountryCode: string; destinationCountryName: string;
  service: "COURIER" | "CARGO"; fromKg: number; toKg: number; calculation: VendorCostRate["calculation"];
  amountMinor: number; percentageBasisPoints: number; effectiveFrom: string; effectiveTo: string | null;
}) {
  return requestJson<{ success: true; message: string; rate: VendorCostRate }>("/api/v1/profitability/vendor-rates", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function retireProfitabilityRate(rateId: string, reason: string) {
  return requestJson<{ success: true; message: string; rate: VendorCostRate }>(`/api/v1/profitability/vendor-rates/${rateId}/retire`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason })
  });
}
