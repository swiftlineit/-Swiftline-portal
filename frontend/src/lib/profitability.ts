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
  costSource: "LEGACY" | "FLIGHT_ALLOCATION";
  flightCostSheetId: string | null;
  operationsManifestId: string | null;
  flight: { manifestNumber: string; mawbNumber: string; flightNumber: string; flightDate: string } | null;
  flightAllocation: Array<{ component: FlightAllocationComponent; amountMinor: number }>;
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

export const flightAllocationComponents = ["AIR_FREIGHT", "AIR_FREIGHT_GST", "EICF", "CUSTOMS", "TRANSPORTATION", "CFL", "DPD_LABEL"] as const;
export type FlightAllocationComponent = (typeof flightAllocationComponents)[number];
export const flightAllocationLabels: Record<FlightAllocationComponent, string> = {
  AIR_FREIGHT: "Air freight",
  AIR_FREIGHT_GST: "GST on air freight",
  EICF: "EICF",
  CUSTOMS: "Customs",
  TRANSPORTATION: "Transportation",
  CFL: "CFL",
  DPD_LABEL: "DPD labels"
};

export type ProfitabilityOverview = {
  currency: "INR";
  today: { revenueMinor: number; costMinor: number; profitMinor: number; marginBasisPoints: number | null };
  monthlyTrend: Array<{ date: string; revenueMinor: number; costMinor: number; profitMinor: number }>;
  monthlyProfitMinor: number;
  lossMaking: ProfitabilityRow[];
  lossMakingFlights: Array<{ id: string; manifestNumber: string; mawbNumber: string; flightNumber: string; flightDate: string; vendor: { id: string; name: string; code?: string } | null; destinationCountryName: string; totalCostMinor: number; totalRevenueMinor: number; grossProfitMinor: number; marginBasisPoints: number | null; status: FlightCostSheet["status"] }>;
  mostProfitableCustomers: Array<{ businessAccountId: string; customerName: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>;
  mostProfitableLanes: Array<{ originCountryCode: string; destinationCountryCode: string; destinationCountryName: string; serviceType: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>;
  mostProfitableDestinations: Array<{ destinationCountryCode: string; destinationCountryName: string; shipments: number; profitMinor: number }>;
  sheetsRequiringCompletion: Array<{ id: string; manifestNumber: string; mawbNumber: string; flightNumber: string; flightDate: string; vendor: { id: string; name?: string } | null; status: FlightCostSheet["status"]; totalCostMinor: number }>;
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

export type FlightRegion = "UK" | "US" | "EUROPE" | "CANADA";

const europeanFlightCountryCodes = new Set([
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE",
  "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT",
  "LU", "MT", "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU",
  "SM", "RS", "SK", "SI", "ES", "SE", "CH", "UA", "VA"
]);

export function flightRegionForCountry(destinationCountryCode: string): FlightRegion | null {
  const code = destinationCountryCode.trim().toUpperCase();
  if (code === "GB") return "UK";
  if (code === "US") return "US";
  if (code === "CA") return "CANADA";
  return europeanFlightCountryCodes.has(code) ? "EUROPE" : null;
}

export function isFlightRateEligible(rate: FlightBuyingRate, destinationCountryCode: string, flightDate: string) {
  const effectiveFrom = rate.effectiveFrom.slice(0, 10);
  const effectiveTo = rate.effectiveTo?.slice(0, 10) ?? null;
  return rate.status === "ACTIVE"
    && flightRegionForCountry(destinationCountryCode) === rate.region
    && effectiveFrom <= flightDate
    && (!effectiveTo || effectiveTo >= flightDate);
}

export type FlightBuyingRate = {
  id: string;
  vendor: { id: string; name?: string; code?: string; status?: LogisticsVendor["status"] };
  region: FlightRegion;
  airFreightRateMinorPerKg: number;
  gstBasisPoints: number;
  eicfRateMinorPerKg: number;
  customsMinor: number;
  transportationMinor: number;
  cflMinorPerBagGbp: number;
  dpdLabelMinorGbp: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "DELETED";
  createdAt: string;
  updatedAt: string;
};

export type FlightManifestOption = {
  id: string;
  manifestNumber: string;
  branchId: string;
  header: {
    destinationAgent: string;
    destinationCountryCode: string;
    destinationCountryName: string;
    flightNumber: string;
    departureDate: string;
    mawbNumber: string;
    originIataCode: string;
    destinationIataCode: string;
    valueType: string;
  };
  status: "DRAFT" | "PACKING" | "READY_TO_SEAL" | "SEALED" | "DISPATCHED" | "CANCELLED";
  totalBags: number;
  totalParcels: number;
  totalWeightKg: number;
  costSheet: { id: string; status: FlightCostSheet["status"] } | null;
};

export type FlightCostTotals = {
  airFreightBaseMinor: number;
  airFreightGstMinor: number;
  airFreightTotalMinor: number;
  eicfMinor: number;
  customsMinor: number;
  transportationMinor: number;
  cflGbpMinor: number;
  cflInrMinor: number;
  dpdLabelsGbpMinor: number;
  dpdLabelsInrMinor: number;
  totalCostMinor: number;
  totalRevenueMinor: number;
  grossProfitMinor: number;
  marginBasisPoints: number | null;
};

export type FlightCostSheet = {
  id: string;
  operationsManifestId: string;
  branchId: string;
  buyingRateId: string;
  vendor: { id: string; name?: string; code?: string };
  manifestNumber: string;
  region: FlightRegion;
  airlineName: string;
  mawbNumber: string;
  flightNumber: string;
  flightDate: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  manifestWeightKg: number;
  billedWeightKg: number;
  billedWeightOverrideReason: string;
  totalBags: number;
  totalParcels: number;
  portalDpdLabels: number;
  externalPaidLabels: number;
  externalLabelReference: string;
  externalLabelReason: string;
  missingDpdLabels: number;
  billableLabels: number;
  rateSnapshot: Omit<FlightBuyingRate, "id" | "vendor" | "region" | "effectiveFrom" | "effectiveTo" | "status" | "createdAt" | "updatedAt">;
  fxSnapshot: { gbpToInr: number; provider: string; providerUpdatedAt: string | null; fetchedAt: string; isManual: boolean; manualReason: string };
  totals: FlightCostTotals;
  status: "DRAFT" | "FINALIZED" | "REVIEW_REQUIRED" | "CANCELLED";
  version: number;
  revision: number;
  notes: string;
  lastChangeReason: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FlightCostAllocation = {
  id: string;
  shipmentDraftId: string;
  awb: string;
  chargeableWeightKg: number;
  parcelCount: number;
  components: Array<{ component: FlightAllocationComponent; amountMinor: number }>;
  totalCostMinor: number;
  totalRevenueMinor: number;
  grossProfitMinor: number;
  marginBasisPoints: number | null;
  revision: number;
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

export function listFlightBuyingRates() {
  return requestJson<{ success: true; rates: FlightBuyingRate[] }>("/api/v1/profitability/flight-rates");
}

export type FlightBuyingRateInput = {
  vendorId: string;
  region: FlightRegion;
  airFreightRateMinorPerKg: number;
  gstBasisPoints: number;
  eicfRateMinorPerKg: number;
  customsMinor: number;
  transportationMinor: number;
  cflMinorPerBagGbp: number;
  dpdLabelMinorGbp: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
};

export function createFlightBuyingRate(input: FlightBuyingRateInput) {
  return requestJson<{ success: true; message: string; rate: FlightBuyingRate }>("/api/v1/profitability/flight-rates", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function updateFlightBuyingRate(rateId: string, input: FlightBuyingRateInput) {
  return requestJson<{ success: true; message: string; rate: FlightBuyingRate }>(`/api/v1/profitability/flight-rates/${rateId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function deleteFlightBuyingRate(rateId: string, reason: string) {
  return requestJson<{ success: true; message: string; rate: FlightBuyingRate }>(`/api/v1/profitability/flight-rates/${rateId}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason })
  });
}

export function listFlightManifestOptions(branchId = "") {
  return requestJson<{ success: true; manifests: FlightManifestOption[] }>(`/api/v1/profitability/flight-manifests${queryString({ branchId })}`);
}

export function getFlightManifestPreview(manifestId: string) {
  return requestJson<{ success: true; manifest: FlightManifestOption & { manifestWeightKg: number; billedWeightKg: number; portalDpdLabels: number; externalPaidLabels: number } }>(`/api/v1/profitability/flight-manifests/${manifestId}/preview`);
}

export function listFlightCostSheets(filters: { branchId?: string; status?: string; vendorId?: string; from?: string; to?: string } = {}) {
  return requestJson<{ success: true; sheets: FlightCostSheet[] }>(`/api/v1/profitability/flight-cost-sheets${queryString(filters as Record<string, string|number|undefined>)}`);
}

export function getFlightCostSheet(sheetId: string) {
  return requestJson<{ success: true; sheet: FlightCostSheet; allocations: FlightCostAllocation[] }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}`);
}

export function listFlightCostRevisions(sheetId: string) {
  return requestJson<{ success: true; revisions: Array<{ id: string; revision: number; version: number; status: string; totals: FlightCostTotals; changeReason: string; createdAt: string }> }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}/revisions`);
}

export function cancelFlightCostSheet(sheetId: string, expectedVersion: number, reason: string) {
  return requestJson<{ success: true; message: string; sheet: FlightCostSheet }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion, reason })
  });
}

export function markFlightSheetReview(sheetId: string, expectedVersion: number, reason: string) {
  return requestJson<{ success: true; message: string; sheet: FlightCostSheet }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}/review`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion, reason })
  });
}

export function triggerManifestReviewCheck(manifestId: string) {
  return requestJson<{ success: true; message: string; reviewed: boolean; sheet?: FlightCostSheet }>(`/api/v1/profitability/flight-manifests/${manifestId}/review-check`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
  });
}

export function getGbpToInrRate() {
  return requestJson<{ success: true; rate: { gbpToInr: number; provider: string; providerUpdatedAt: string | null; fetchedAt: string } }>("/api/v1/profitability/fx/gbp-inr");
}

export type FlightCostSheetInput = {
  buyingRateId: string;
  airlineName: string;
  billedWeightKg?: number;
  billedWeightOverrideReason: string;
  externalPaidLabels: number;
  externalLabelReference: string;
  externalLabelReason: string;
  fxSnapshot: { gbpToInr: number; provider: string; providerUpdatedAt: string | null; fetchedAt: string; isManual: boolean; manualReason: string };
  notes: string;
  reason: string;
};

export function createFlightCostSheet(input: FlightCostSheetInput & { operationsManifestId: string }) {
  return requestJson<{ success: true; message: string; sheet: FlightCostSheet }>("/api/v1/profitability/flight-cost-sheets", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function updateFlightCostSheet(sheetId: string, input: FlightCostSheetInput & { expectedVersion: number }) {
  return requestJson<{ success: true; message: string; sheet: FlightCostSheet }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function finalizeFlightCostSheet(sheetId: string, expectedVersion: number, reason: string) {
  return requestJson<{ success: true; message: string; sheet: FlightCostSheet }>(`/api/v1/profitability/flight-cost-sheets/${sheetId}/finalize`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion, reason })
  });
}
