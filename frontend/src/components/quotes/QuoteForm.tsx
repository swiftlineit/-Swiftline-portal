"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiTag, FiMinus, FiPlus, FiSend, FiTruck, FiChevronDown  } from "react-icons/fi";
import { IoIosAirplane, IoMdSend } from "react-icons/io";
import { BiMath } from "react-icons/bi";

import { toast } from "react-toastify";
import { countryOptions } from "@/lib/branches";
import CountryFlag from "@/components/CountryFlag";
import { findRestrictedCategories } from "@/lib/restrictedGoods";
import { csbTypeOptions, type CsbType } from "@/lib/csbType";
import { quoteDocumentOptions, type QuoteDocumentCode } from "@/lib/quoteDocuments";
import { getVolumetricFormula } from "@/lib/shipmentPricing";
import InfoTooltip from "@/components/ui/InfoTooltip";
import {
  createShipmentDraftFromQuote,
  createShipmentQuote,
  estimateShipmentQuote,
  formatQuoteMoney,
  type QuoteAudience,
  type QuoteContext,
  type QuoteEstimate,
  type QuoteParcelInput,
  type ShipmentQuoteInput,
} from "@/lib/shipmentQuotes";
import { BsChatSquareDots } from "react-icons/bs";

const shipmentTypes: Array<{
  value: ShipmentQuoteInput["shipmentType"];
  label: string;
}> = [
  { value: "DOCUMENTS", label: "Documents" },
  { value: "PARCEL", label: "Parcel" },
  { value: "MERCHANDISE", label: "Merchandise" },
  { value: "GIFTS", label: "Gift" },
  { value: "SAMPLES", label: "Sample" },
  { value: "RETURNS", label: "Returns" },
  { value: "OTHER", label: "Other" },
];

// Options for the per-box "Contents" dropdown.
const boxContentOptions = [
  "Documents",
  "Parcel",
  "Gifts",
  "Clothes",
  "Electronics",
  "Cosmetics",
  "Books",
  "Samples",
  "Spare Parts",
  "Other",
];

// Placeholder transit-time estimates until real carrier SLAs are wired up.
// Keyed by service type so the value can vary later without touching the UI.
const transitTimeEstimates: Record<ShipmentQuoteInput["serviceType"], string> = {
  COURIER: "3-5 days",
  CARGO: "3-5 days",
};

const emptyParcel = (sequence: number): QuoteParcelInput => ({
  sequence,
  actualWeightKg: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  contents: "",
});

export default function QuoteForm({
  audience,
  contexts,
  initialContext,
}: {
  audience: QuoteAudience;
  contexts: QuoteContext[];
  initialContext?: QuoteContext | null;
}) {
  const router = useRouter();
  const [businessAccountId, setBusinessAccountId] = useState(
    initialContext?.businessAccountId ?? contexts[0]?.businessAccountId ?? "",
  );
  const [countryCode, setCountryCode] = useState("");
  const [shipmentType, setShipmentType] =
    useState<ShipmentQuoteInput["shipmentType"]>("PARCEL");
  // Mandatory customs route. Left unset so the customer must choose deliberately
  // rather than defaulting into (or out of) the CSB-V clearance charge.
  const [csbType, setCsbType] = useState<CsbType | "">("");
  const [availableDocuments, setAvailableDocuments] = useState<QuoteDocumentCode[]>([]);
  const [serviceType, setServiceType] =
    useState<ShipmentQuoteInput["serviceType"]>("COURIER");
  const [goodsValue, setGoodsValue] = useState("");
  const [parcels, setParcels] = useState<QuoteParcelInput[]>([emptyParcel(1)]);
  const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
  const [busy, setBusy] = useState<"estimate" | "request" | "draft" | "">("");
  const [submitted, setSubmitted] = useState(false);
  // Highlights each box's contents field as the customer types, before any submit is attempted.
  const restrictedContentsByParcel = parcels.map((parcel) => findRestrictedCategories(parcel.contents));

  const context =
    contexts.find((item) => item.businessAccountId === businessAccountId) ??
    initialContext ??
    contexts[0] ??
    null;
  const country = countryOptions.find((item) => item.code === countryCode);
  const totals = useMemo(
    () => ({
      actual: parcels.reduce(
        (sum, item) => sum + Number(item.actualWeightKg || 0),
        0,
      ),
      volumetric:
        estimate?.parcels.reduce(
          (sum, item) => sum + item.volumetricWeightKg,
          0,
        ) ?? 0,
      chargeable:
        estimate?.parcels.reduce(
          (sum, item) => sum + item.chargeableWeightKg,
          0,
        ) ?? 0,
    }),
    [estimate, parcels],
  );

  function payload(): ShipmentQuoteInput | null {
    setSubmitted(true);
    // Same rule as the create-shipment contents field: restricted goods are
    // refused at entry rather than after a quote has been priced.
    const restricted = parcels.flatMap((parcel) => findRestrictedCategories(parcel.contents));
    if (restricted.length) {
      toast.error(`${restricted.join(", ")} is a restricted item and cannot be shipped.`);
      return null;
    }
    if (!csbType) {
      toast.error("Select the shipment type: CSB-IV or CSB-V.");
      return null;
    }
    if (!availableDocuments.length) {
      toast.error("Select at least one available document.");
      return null;
    }
    if (
      !context ||
      !country ||
      !goodsValue.trim() ||
      Number(goodsValue) <= 0 ||
      !parcels.length ||
      parcels.some((item) => item.actualWeightKg <= 0 || !item.contents.trim())
    ) {
      toast.error("Complete the required shipment and package details.");
      return null;
    }
    return {
      businessAccountId: context.businessAccountId,
      destinationCountryCode: country.code,
      destinationCountryName: country.name,
      shipmentType,
      csbType,
      serviceType,
      goodsValueMinor: Math.max(0, Math.round((Number(goodsValue) || 0) * 100)),
      availableDocuments,
      parcels: parcels.map((parcel) => ({ ...parcel, contents: parcel.contents.trim() })),
    };
  }

  async function calculate() {
    const input = payload();
    if (!input) return;
    setBusy("estimate");
    try {
      const result = await estimateShipmentQuote(audience, input);
      setEstimate(result.estimate);
      if (result.estimate.missingRate) {
        toast.info(
          "No rate is available for the selected country. Please contact your assigned branch for pricing.",
        );
      } else {
        toast.success("Estimated charges calculated.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to calculate this estimate.",
      );
    } finally {
      setBusy("");
    }
  }

  async function requestLiveQuote() {
    const input = payload();
    if (!input) return;
    setBusy("request");
    try {
      const result = await createShipmentQuote(audience, input);
      toast.success("Live quote request submitted to Swiftline.");
      router.push(
        audience === "client"
          ? `/client/quotes/${result.quote.id}`
          : `/dashboard/quote-requests/${result.quote.id}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to submit the quote request.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createDraft() {
    const input = payload();
    if (!input || !estimate || estimate.missingRate) return;
    setBusy("draft");
    try {
      const result = await createShipmentDraftFromQuote(audience, input);
      toast.success("Shipment draft created from the estimate.");
      router.push(
        audience === "client"
          ? `/client/dpd-labels/${result.shipmentDraftId}`
          : `/dashboard/dpd-labels/${result.shipmentDraftId}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create the shipment draft.",
      );
    } finally {
      setBusy("");
    }
  }

  function updateParcel(
    index: number,
    field: keyof QuoteParcelInput,
    value: number | string,
  ) {
    setParcels((current) =>
      current.map((parcel, parcelIndex) =>
        parcelIndex === index ? { ...parcel, [field]: value } : parcel,
      ),
    );
    setEstimate(null);
  }

  function addParcel() {
    setParcels((current) => [...current, emptyParcel(current.length + 1)]);
    setEstimate(null);
  }

  function removeParcel(index: number) {
    setParcels((current) =>
      current
        .filter((_, parcelIndex) => parcelIndex !== index)
        .map((item, parcelIndex) => ({ ...item, sequence: parcelIndex + 1 })),
    );
    setEstimate(null);
  }

  function removeAllParcels() {
    setParcels([emptyParcel(1)]);
    setEstimate(null);
  }

 return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {/* Customs route. Kept at the top because CSB-V changes what is charged. */}
        <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
          <SectionHeader
            title="Shipment Type"
            subtitle="Select the customs route for this shipment."
          />
          <div className="p-5">
            <CsbTypeSelector
              value={csbType}
              onChange={(value) => {
                setCsbType(value);
                setEstimate(null);
              }}
              error={submitted && !csbType ? "Select CSB-IV or CSB-V." : ""}
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
          <SectionHeader
            title="Shipment Details"
            subtitle="Weights are in kilograms and dimensions are in centimetres."
          />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {audience === "admin" ? (
              <Field label="Business Account" required>
                <div className="relative">
                  <select
                    value={businessAccountId}
                    onChange={(event) => {
                      setBusinessAccountId(event.target.value);
                      setEstimate(null);
                    }}
                    className={`${controlClass} appearance-none pr-9`}
                  >
                    <option value="">Select business account</option>
                    {contexts.map((item) => (
                      <option
                        key={item.businessAccountId}
                        value={item.businessAccountId}
                      >
                        {item.companyName} ({item.accountId})
                      </option>
                    ))}
                  </select>
                  <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </Field>
            ) : (
              <ReadOnly
                label="Business Account"
                value={
                  context
                    ? `${context.companyName} (${context.accountId})`
                    : "Not available"
                }
              />
            )}
            <ReadOnly
              label="Origin City"
              value={context?.originCity || "Not available"}
            />
            <Field
              label="Destination Country"
              required
              error={
                submitted && !country ? "Select a destination country." : ""
              }
            >
              <div className="relative">
                {/* Flag emoji don't render on Windows, so the selected flag is drawn
                    as an inline SVG badge overlaid on a plain-text native select. */}
                {countryCode ? (
                  <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 items-center">
                    <CountryFlag code={countryCode} />
                  </span>
                ) : null}
                <select
                  value={countryCode}
                  onChange={(event) => {
                    setCountryCode(event.target.value);
                    setEstimate(null);
                  }}
                  className={`${controlClass} appearance-none pr-9 rounded-xl ${countryCode ? "pl-11" : ""}`}
                >
                  <option value="">Select destination country</option>
                  {countryOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>
            <Field label="Content Type" required>
              <div className="relative">
                <select
                  value={shipmentType}
                  onChange={(event) => {
                    setShipmentType(
                      event.target.value as ShipmentQuoteInput["shipmentType"],
                    );
                    setEstimate(null);
                  }}
                  className={`${controlClass} appearance-none pr-9 rounded-xl`}
                >
                  {shipmentTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>
            <Field label="Service" required>
              <div className="relative">
                <select
                  value={serviceType}
                  onChange={(event) => {
                    setServiceType(
                      event.target.value as ShipmentQuoteInput["serviceType"],
                    );
                    setEstimate(null);
                  }}
                  className={`${controlClass} appearance-none pr-9 rounded-xl`}
                >
                  <option value="COURIER">Courier</option>
                  <option value="CARGO">Cargo</option>
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>
            <Field
              label="Goods Value (INR)"
              required
              error={
                submitted && Number(goodsValue) <= 0
                  ? "Enter the shipment's goods value."
                  : ""
              }
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={goodsValue}
                onChange={(event) => setGoodsValue(event.target.value)}
                placeholder="0.00"
                className={controlClass}
              />
            </Field>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-950">Package Details</h2>
              <p className="mt-1 text-sm text-slate-500">
                Add one row for every physical box.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={removeAllParcels}
                className="inline-flex h-10 items-center gap-2 px-4 rounded-4xl border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
              >
                <FiMinus /> Remove All
              </button>
              <button
                type="button"
                onClick={addParcel}
                className="inline-flex h-10 items-center gap-2  pl-3 rounded-4xl border border-blue-900  text-sm font-semibold  text-blue-900 hover:bg-blue-800 hover:text-white"
              >
                <FiPlus /> Add Box  <span className="inline-flex mr-1 h-8 px-8 items-center justify-center rounded-4xl bg-blue-50 text-sm font-semibold text-slate-900">
                {parcels.length}
              </span>
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-200">
            {parcels.map((parcel, index) => (
              <div key={parcel.sequence} className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">
                    Box {index + 1}
                  </p>
                  {parcels.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeParcel(index)}
                      aria-label={`Remove box ${index + 1}`}
                      className="flex h-8 w-8 items-center justify-center rounded-4xl border border-slate-300 text-red-600 hover:bg-red-50"
                    >
                      <FiMinus />
                    </button>
                  ) : null}
                </div>
                <div className="mb-4">
                  <Field
                    label="Contents"
                    required
                    tooltip="What's inside this box"
                    error={
                      restrictedContentsByParcel[index]?.length
                        ? `${restrictedContentsByParcel[index].join(", ")} is a restricted item and cannot be shipped.`
                        : submitted && !parcel.contents.trim()
                          ? "Select this box's contents."
                          : ""
                    }
                  >
                    <div className="relative">
                      <select
                        value={parcel.contents}
                        onChange={(event) => updateParcel(index, "contents", event.target.value)}
                        onBlur={() => {
                          if (restrictedContentsByParcel[index]?.length) toast.error("This item is restricted.");
                        }}
                        className={`${controlClass} appearance-none pr-9 rounded-xl ${
                          restrictedContentsByParcel[index]?.length ? "border-red-400 focus:border-red-500" : ""
                        }`}
                      >
                        <option value="">Select contents</option>
                        {boxContentOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      "actualWeightKg",
                      "lengthCm",
                      "widthCm",
                      "heightCm",
                    ] as const
                  ).map((field) => (
                    <Field
                      key={field}
                      label={
                        {
                          actualWeightKg: "Actual Weight KG",
                          lengthCm: "Length CM",
                          widthCm: "Width CM",
                          heightCm: "Height CM",
                        }[field]
                      }
                      required={field === "actualWeightKg"}
                    >
                      <input
                        type="number"
                        min={field === "actualWeightKg" ? "0.01" : "0"}
                        step="0.01"
                        value={parcel[field] || ""}
                        onChange={(event) =>
                          updateParcel(index, field, Number(event.target.value))
                        }
                        className={`${controlClass} ${
                          field === "actualWeightKg" && submitted && parcel.actualWeightKg <= 0
                            ? "border-red-400"
                            : ""
                        }`}
                      />
                    </Field>
                  ))}
                </div>
                {submitted && parcel.actualWeightKg <= 0 ? (
                  <p className="mt-3 text-xs font-semibold text-red-600">
                    Enter the actual weight for this box.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {/* Declarations only — no uploads happen at the quote stage. */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="Available Documents"
            subtitle="Tick the export documents you already hold. At least one is required."
          />
          <div className="p-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {quoteDocumentOptions.map((option) => {
                const checked = availableDocuments.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition ${
                      checked
                        ? "border-blue-900 bg-blue-50 font-semibold text-blue-950"
                        : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAvailableDocuments((current) =>
                          current.includes(option.value)
                            ? current.filter((code) => code !== option.value)
                            : [...current, option.value],
                        )
                      }
                      className="h-4 w-4 shrink-0 accent-blue-900"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            {submitted && !availableDocuments.length ? (
              <p className="mt-3 text-xs font-semibold text-red-600">
                Select at least one available document.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white xl:sticky xl:top-0">
        <SectionHeader
          title="Quote Summary"
          subtitle="Estimated from the active country rate card."
        />
        <div className="space-y-5 p-5">
          {context?.originCity && country ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-500 bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-800">
              <span>{context.originCity}</span>  ---
              <IoIosAirplane className="text-white text-3xl" aria-hidden="true" />
              ---
              <span>{country.name}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-3  border border-slate-200 rounded">
            <SummaryMetric
              label="Actual"
              value={`${totals.actual.toFixed(2)} kg`}
            />
            <SummaryMetric
              label="Volumetric"
              value={`${totals.volumetric.toFixed(2)} kg`}
              tooltip={getVolumetricFormula(serviceType)}
            />
            <SummaryMetric
              label="Chargeable"
              value={`${totals.chargeable.toFixed(2)} kg`}
            />
          </div>

          {estimate?.parcels.map((parcel) => (
            <div
              key={parcel.sequence}
              className="border-b border-slate-200 pb-4 text-sm"
            >
              <div className="flex justify-between gap-4 font-semibold text-slate-900">
                <span>Box {parcel.sequence}</span>
                <span>{formatQuoteMoney(parcel.baseAmountMinor)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {parcel.chargeableWeightKg.toFixed(2)} kg chargeable{" "}
                {parcel.chargesPerKg === null
                  ? "| No rate"
                  : `| ${formatQuoteMoney(parcel.chargesPerKg * 100)} / kg`}
              </p>
              {parcel.exceedsMaxBoxKg ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Exceeds the {parcel.maxBoxKg} kg maximum box weight.
                </p>
              ) : null}
            </div>
          ))}

          <div className="space-y-3 text-sm">
            <Line
              label="Freight"
              value={formatQuoteMoney(estimate?.freightMinor)}
            />
            {/* Charged once for the whole shipment, so it sits outside the per-box
                rows above. Hidden entirely on CSB-IV, which has no such charge. */}
            {estimate && estimate.csbClearanceMinor > 0 ? (
              <Line
                label="CSB-V Clearance Charge"
                value={formatQuoteMoney(estimate.csbClearanceMinor)}
              />
            ) : null}
            <Line
              label="Fuel Surcharge"
              value={estimate ? "Not configured" : "-"}
              muted
            />
            <Line
              label="Taxable Add-ons"
              value={estimate ? "Not configured" : "-"}
              muted
            />
            <Line
              label="GST (18%)"
              value={estimate ? formatQuoteMoney(estimate.gstMinor) : "-"}
            />
            <div className="flex items-end justify-between gap-4 border-t border-slate-300 pt-4">
              <span className="font-semibold text-slate-900">
                Estimated Total
              </span>
              <span className="text-2xl font-semibold text-blue-950">
                {estimate && !estimate.missingRate
                  ? formatQuoteMoney(estimate.totalMinor)
                  : "-"}
              </span>
            </div>
            {/* Only meaningful once an estimate has been calculated, so it stays
                hidden until the customer clicks Calculate Estimate. */}
            {estimate ? (
              <Line
                label="Estimated Transit Time"
                value={transitTimeEstimates[serviceType]}
              />
            ) : null}
          </div>

          {estimate?.missingRate ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              No rate is available for this route. Submit a live quote request
              or contact {context?.branchName || "your branch"}.
            </div>
          ) : null}
          <p className="text-xs leading-5 text-slate-500">
            This is an estimate. Charges are recalculated during booking and
            final weight verification.
          </p>

          {/* Sets expectations before a live quote is requested: the estimate
              above comes from the rate card, but Swiftline prices the final rate. */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            <span className="font-semibold">Note:</span> The final rate will be
            decided based on the postal code, content and region.
          </div>

          <button
            type="button"
            onClick={() => void calculate()}
            disabled={Boolean(busy)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-4xl bg-blue-950 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:bg-slate-400"
          >
            <BiMath />
            {busy === "estimate" ? "Calculating..." : "Calculate Estimate"}
          </button>
          <button
            type="button"
            onClick={() => void requestLiveQuote()}
            disabled={Boolean(busy)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-4xl border border-blue-900 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:border-slate-300 disabled:text-slate-400"
          >
            <IoMdSend />
            {busy === "request" ? "Submitting..." : "Get Live Quote"}
          </button>
          <button
            type="button"
            onClick={() => void createDraft()}
            disabled={Boolean(busy) || !estimate || estimate.missingRate}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-4xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <FiTruck />
            {busy === "draft" ? "Creating Draft..." : "Book Shipment"}
          </button>
        
          {context?.branchContact.email || context?.branchContact.phone ? (
    
            <a
              href={
               '/client/tickets'
              }
              className="block text-center text-sm font-semibold text-blue-900"

              
            >
                       <span className="inline-flex items-center gap-2">
                <BsChatSquareDots />
                Contact Support
              </span> 
                       
            </a>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

const controlClass =
  "h-11 w-full border border-slate-300 rounded-xl bg-white px-3 pr-9 text-sm text-slate-950 outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900";

/**
 * Mandatory CSB-IV / CSB-V choice, rendered as two selectable cards. Uses radio
 * inputs so only one can ever be active and keyboard/screen-reader users get the
 * grouped single-choice semantics.
 */
function CsbTypeSelector({
  value,
  onChange,
  error,
}: {
  value: CsbType | "";
  onChange: (value: CsbType) => void;
  error?: string;
}) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {csbTypeOptions.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                checked
                  ? "border-blue-900 bg-blue-50"
                  : error
                    ? "border-red-400 bg-white hover:border-red-500"
                    : "border-slate-300 bg-white hover:border-blue-300"
              }`}
            >
              <input
                type="radio"
                name="csbType"
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-900"
              />
              <span className="block">
                <span
                  className={`block text-sm font-semibold ${checked ? "text-blue-950" : "text-slate-900"}`}
                >
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="border-b border-slate-200 px-5 py-4">
      <h2 className="font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
function Field({
  label,
  required,
  error,
  tooltip,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1 text-xs font-semibolduppercase text-slate-600">
        {label}
        {required ? <span className="text-red-600">*</span> : null}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-semibold text-red-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 min-h-11 border border-slate-200 rounded-xl bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}
function SummaryMetric({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className=" px-3 py-3 text-center ">
      <p className="flex items-center justify-center gap-1 text-xs font-semibold uppercase text-slate-500">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-600">{label}</span>
      <span
        className={`font-semibold ${muted ? "text-slate-500" : "text-slate-950"}`}
      >
        {value}
      </span>
    </div>
  );
}
