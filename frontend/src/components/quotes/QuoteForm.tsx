"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiTag, FiMinus, FiPlus, FiSend, FiTruck, FiChevronDown  } from "react-icons/fi";
import { IoIosAirplane, IoMdSend } from "react-icons/io";
import { BiMath } from "react-icons/bi";

import { toast } from "react-toastify";
import { countryOptions } from "@/lib/branches";
import { getCountryFlag } from "@/lib/countryRateCards";
import { findRestrictedCategories } from "@/lib/restrictedGoods";
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

const emptyParcel = (sequence: number): QuoteParcelInput => ({
  sequence,
  actualWeightKg: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
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
  const [serviceType, setServiceType] =
    useState<ShipmentQuoteInput["serviceType"]>("COURIER");
  const [goodsValue, setGoodsValue] = useState("");
  const [contents, setContents] = useState("");
  const [parcels, setParcels] = useState<QuoteParcelInput[]>([emptyParcel(1)]);
  const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
  const [busy, setBusy] = useState<"estimate" | "request" | "draft" | "">("");
  const [submitted, setSubmitted] = useState(false);
  // Highlights the field as the customer types, before any submit is attempted.
  const restrictedContents = findRestrictedCategories(contents);

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
    const restricted = findRestrictedCategories(contents);
    if (restricted.length) {
      toast.error(`${restricted.join(", ")} is a restricted item and cannot be shipped.`);
      return null;
    }
    if (
      !context ||
      !country ||
      !contents.trim() ||
      !parcels.length ||
      parcels.some(
        (item) =>
          item.actualWeightKg <= 0 ||
          item.lengthCm <= 0 ||
          item.widthCm <= 0 ||
          item.heightCm <= 0,
      )
    ) {
      toast.error("Complete the required shipment and package details.");
      return null;
    }
    return {
      businessAccountId: context.businessAccountId,
      destinationCountryCode: country.code,
      destinationCountryName: country.name,
      shipmentType,
      serviceType,
      goodsValueMinor: Math.max(0, Math.round((Number(goodsValue) || 0) * 100)),
      contents: contents.trim(),
      parcels,
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
    value: number,
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

  const invalidParcel = (parcel: QuoteParcelInput) =>
    submitted &&
    (parcel.actualWeightKg <= 0 ||
      parcel.lengthCm <= 0 ||
      parcel.widthCm <= 0 ||
      parcel.heightCm <= 0);

 return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
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
                <select
                  value={countryCode}
                  onChange={(event) => {
                    setCountryCode(event.target.value);
                    setEstimate(null);
                  }}
                  className={`${controlClass} appearance-none pr-9 rounded-xl`}
                >
                  <option value="">Select destination country</option>
                  {countryOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {getCountryFlag(item.code)} {item.name}
                    </option>
                  ))}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>
            <Field label="Shipment Type" required>
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
            <Field label="Goods Value (INR)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={goodsValue}
                onChange={(event) => setGoodsValue(event.target.value)}
                placeholder="0.00"
                className={controlClass}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Contents"
                required
                tooltip="Items/product details"
                error={
                  restrictedContents.length
                    ? `${restrictedContents.join(", ")} is a restricted item and cannot be shipped.`
                    : submitted && !contents.trim()
                      ? "Describe the shipment contents."
                      : ""
                }
              >
                <textarea
                  value={contents}
                  onChange={(event) => {
                    setContents(event.target.value);
                    setEstimate(null);
                  }}
                  onBlur={() => {
                    if (restrictedContents.length) toast.error("This item is restricted.");
                  }}
                  rows={3}
                  placeholder="Describe the goods being shipped"
                  className={`${controlClass} h-auto py-3 ${
                    restrictedContents.length ? "border-red-400 focus:border-red-500" : ""
                  }`}
                />
              </Field>
            </div>
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
                      required
                    >
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={parcel[field] || ""}
                        onChange={(event) =>
                          updateParcel(index, field, Number(event.target.value))
                        }
                        className={`${controlClass} ${invalidParcel(parcel) && parcel[field] <= 0 ? "border-red-400" : ""}`}
                      />
                    </Field>
                  ))}
                </div>
                {invalidParcel(parcel) ? (
                  <p className="mt-3 text-xs font-semibold text-red-600">
                    Enter positive weight and dimensions for this box.
                  </p>
                ) : null}
              </div>
            ))}
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
