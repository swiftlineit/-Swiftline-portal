"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { FiCheckCircle, FiExternalLink, FiMapPin, FiSave, FiSearch, FiTruck } from "react-icons/fi";
import { toast } from "react-toastify";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import {
  ShipmentFieldLabel,
  ShipmentPhoneCodeField,
  ShipmentSelectField,
  ShipmentTextField
} from "@/components/shipments/ShipmentFormControls";
import { ShipmentLabelsPanel } from "@/components/shipments/ShipmentLabelsPanel";
import { CountryRateCard, formatCountryRateService, listCountryRateCards } from "@/lib/countryRateCards";
import {
  AddressPrediction,
  DpdShipmentHistoryItem,
  ShipmentDraft,
  ShipmentContentType,
  ShipmentServiceType,
  autocompleteAddress,
  confirmAddress,
  createDpdLabel,
  createSwiftlineShipment,
  formatShipmentValidationIssues,
  getDpdLabelAccessUrl,
  getPlaceAddress,
  getShipmentDraft,
  listDpdShipments,
  shipmentContentTypeOptions,
  updateShipmentDraft,
  validateAddress,
  validateShipmentDraft
} from "@/lib/dpdLabels";
import { calculateShipmentEstimate, formatMoney } from "@/lib/shipmentPricing";
import { useAdminUser } from "@/lib/useAdminUser";

type DpdShipmentResult = Awaited<ReturnType<typeof createDpdLabel>>;
type AddressForm = {
  countryCode: string;
  countryName: string;
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
};
type DraftCorrectionForm = {
  companyName: string;
  contactName: string;
  email: string;
  mobileCountryCode: string;
  mobileNumber: string;
  deliveryInstructions: string;
  serviceType: ShipmentServiceType;
  serviceCode: string;
};
type ParcelForm = {
  sequence: number;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  shipmentContentType: ShipmentContentType;
  contentsDescription: string;
  shipmentReference1: string;
  shipmentReference2: string;
};

const maxParcelCount = 10;
const prohibitedItems = [
  "Alcohol / Liquor",
  "Tobacco / Nicotine / Vape",
  "Cash / Currency",
  "Gold / Silver / Precious Metals",
  "Gems / Diamonds",
  "Arms / Ammunition / Weapons",
  "Explosives / Fireworks",
  "Flammable Items",
  "Dangerous Chemicals",
  "Poison / Toxic Material",
  "Prescription Medicines",
  "Narcotics / Drugs",
  "Live Animals",
  "Plants / Seeds",
  "Pornographic Material",
  "Counterfeit Goods",
  "Loose battery / power bank without approval",
  "Perishable fresh food",
  "Human remains / ashes without approval"
];

function getCountryName(countryCode: string) {
  return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode.toUpperCase()) ?? countryCode;
}

function createEmptyParcelForm(sequence: number): ParcelForm {
  return {
    sequence,
    weightKg: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    shipmentContentType: "PARCEL",
    contentsDescription: "",
    shipmentReference1: "",
    shipmentReference2: ""
  };
}

function SourceBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-500">
      {children}
    </span>
  );
}

function getFieldIssue(issues: string[], patterns: string[]) {
  return issues.find((issue) => patterns.every((pattern) => issue.toLowerCase().includes(pattern)));
}

function getReviewFormIssues(addressForm: AddressForm, draftCorrectionForm: DraftCorrectionForm, parcelForms: ParcelForm[]) {
  const issues: string[] = [];

  if (!draftCorrectionForm.contactName.trim()) issues.push("Contact name is required");
  if (!draftCorrectionForm.mobileCountryCode.trim()) issues.push("Mobile country code is required");
  if (!draftCorrectionForm.mobileNumber.trim()) issues.push("Mobile number is required");
  if (draftCorrectionForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draftCorrectionForm.email.trim())) {
    issues.push("Enter a valid email address");
  }
  if (!addressForm.countryCode.trim()) issues.push("Country is required");
  if (!addressForm.addressLine1.trim()) issues.push("Address line 1 is required");
  if (!addressForm.townOrCity.trim()) issues.push("Town or city is required");
  if (!addressForm.postcode.trim()) issues.push("Postcode is required");
  if (!parcelForms.length) issues.push("At least one parcel is required");
  if (parcelForms.length > maxParcelCount) issues.push(`Number of Parcels (PCS) must be ${maxParcelCount} or fewer`);
  parcelForms.forEach((parcel, index) => {
    const weightKg = Number(parcel.weightKg);
    const label = `Parcel ${index + 1}`;
    if (parcel.sequence !== index + 1) issues.push(`${label}: sequence must be ${index + 1}`);
    if (!parcel.weightKg.trim() || !Number.isFinite(weightKg) || weightKg <= 0) {
      issues.push(`${label}: weight must be greater than zero`);
    }
    for (const [field, value] of [["length", parcel.lengthCm], ["width", parcel.widthCm], ["height", parcel.heightCm]]) {
      if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0) {
        issues.push(`${label}: ${field} must be greater than zero`);
      }
    }
    if (!parcel.shipmentContentType) issues.push(`${label}: shipment content type is required`);
    if (!parcel.contentsDescription.trim()) issues.push(`${label}: contents description is required`);
  });
  return issues;
}

function normalizeParcelForms(parcels: ShipmentDraft["parcelList"]): ParcelForm[] {
  const sourceParcels: ShipmentDraft["parcelList"] = parcels.length
    ? parcels
    : [{ sequence: 1, weightKg: 0, shipmentContentType: "PARCEL", contentsDescription: "" }];

  return sourceParcels.map((parcel, index) => ({
    sequence: index + 1,
    weightKg: parcel.weightKg ? String(parcel.weightKg) : "",
    lengthCm: parcel.lengthCm ? String(parcel.lengthCm) : "",
    widthCm: parcel.widthCm ? String(parcel.widthCm) : "",
    heightCm: parcel.heightCm ? String(parcel.heightCm) : "",
    shipmentContentType: parcel.shipmentContentType ?? "PARCEL",
    contentsDescription: parcel.contentsDescription ?? "",
    shipmentReference1: parcel.shipmentReference1 ?? "",
    shipmentReference2: parcel.shipmentReference2 ?? ""
  }));
}

function isParcelFormEmpty(parcel: ParcelForm) {
  return !parcel.weightKg && !parcel.lengthCm && !parcel.widthCm && !parcel.heightCm
    && parcel.shipmentContentType === "PARCEL"
    && !parcel.contentsDescription && !parcel.shipmentReference1 && !parcel.shipmentReference2;
}

function shipmentHistoryToResult(item: DpdShipmentHistoryItem): DpdShipmentResult {
  return {
    success: true,
    reused: true,
    dpdShipment: {
      id: item.dpdShipment.id,
      dpdShipmentId: item.dpdShipment.dpdShipmentId,
      dpdTransactionId: item.dpdShipment.dpdTransactionId,
      swiftlineTrackingNumber: item.dpdShipment.swiftlineTrackingNumber,
      bookingProvider: item.dpdShipment.bookingProvider,
      providerMode: item.dpdShipment.providerMode,
      parcelNumbers: item.dpdShipment.parcelNumbers,
      serviceCode: item.dpdShipment.serviceCode,
      status: item.dpdShipment.status,
      createdAt: item.dpdShipment.createdAt
    },
    labels: item.labels.map((label) => ({
      id: label.id,
      parcelNumber: label.parcelNumber,
      labelType: label.labelType,
      providerMode: label.providerMode,
      format: label.format,
      labelSize: label.labelSize,
      generatedAt: label.generatedAt
    })),
    bookingConfirmation: item.bookingConfirmation,
    shipmentInvoice: item.shipmentInvoice
      ? {
          id: "",
          invoiceNumber: item.shipmentInvoice.invoiceNumber,
          currency: item.shipmentInvoice.currency,
          totalAmountMinor: item.shipmentInvoice.totalAmountMinor,
          revision: item.shipmentInvoice.revision,
          status: item.shipmentInvoice.status
        }
      : null
  };
}

export default function DpdLabelDraftPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const { user, loading } = useAdminUser();
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
  const [result, setResult] = useState<DpdShipmentResult | null>(null);
  const [rates, setRates] = useState<CountryRateCard[]>([]);
  const [addressForm, setAddressForm] = useState<AddressForm>({
    countryCode: "GB",
    countryName: "United Kingdom",
    addressLine1: "",
    addressLine2: "",
    townOrCity: "",
    county: "",
    postcode: ""
  });
  const [draftCorrectionForm, setDraftCorrectionForm] = useState<DraftCorrectionForm>({
    companyName: "",
    contactName: "",
    email: "",
    mobileCountryCode: "",
    mobileNumber: "",
    deliveryInstructions: "",
    serviceType: "COURIER",
    serviceCode: ""
  });
  const [parcelForms, setParcelForms] = useState<ParcelForm[]>([createEmptyParcelForm(1)]);
  const [addressQuery, setAddressQuery] = useState("");
  const [predictions, setPredictions] = useState<AddressPrediction[]>([]);
  const [busy, setBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [error, setError] = useState("");
  const [, setReviewIssues] = useState<string[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [manualAddressConfirmationRequired, setManualAddressConfirmationRequired] = useState(false);

  const correctionChanged = useMemo(() => {
    if (!draft) return false;

    return (
      draftCorrectionForm.companyName !== (draft.consigneeEnteredAddress.companyName ?? "") ||
      draftCorrectionForm.contactName !== (draft.consigneeEnteredAddress.contactName ?? "") ||
      draftCorrectionForm.email !== (draft.consigneeEnteredAddress.email ?? "") ||
      draftCorrectionForm.mobileCountryCode !== (draft.consigneeEnteredAddress.mobileCountryCode ?? "") ||
      draftCorrectionForm.mobileNumber !== (draft.consigneeEnteredAddress.mobileNumber ?? "") ||
      draftCorrectionForm.deliveryInstructions !== (draft.consigneeEnteredAddress.deliveryInstructions ?? "") ||
      JSON.stringify(parcelForms) !== JSON.stringify(normalizeParcelForms(draft.parcelList)) ||
      draftCorrectionForm.serviceType !== (draft.serviceType ?? "COURIER") ||
      draftCorrectionForm.serviceCode !== (draft.serviceCode ?? "")
    );
  }, [draft, draftCorrectionForm, parcelForms]);

  const addressChanged = useMemo(() => {
    if (!draft) return false;

    const address = draft.consigneeEnteredAddress;

    return (
      addressForm.addressLine1 !== (address.addressLine1 ?? "") ||
      addressForm.addressLine2 !== (address.addressLine2 ?? "") ||
      addressForm.townOrCity !== (address.townOrCity ?? "") ||
      addressForm.county !== (address.county ?? "") ||
      addressForm.countryCode !== (address.countryCode ?? "GB") ||
      addressForm.postcode !== (address.postcode ?? "")
    );
  }, [addressForm, draft]);

  const chargeEstimate = useMemo(() => calculateShipmentEstimate({
    parcels: parcelForms,
    rates,
    countryCode: addressForm.countryCode,
    serviceType: draftCorrectionForm.serviceType
  }), [addressForm.countryCode, draftCorrectionForm.serviceType, parcelForms, rates]);

  const draftChanged = correctionChanged || addressChanged;

  const currentReviewIssues = useMemo(
    () => getReviewFormIssues(addressForm, draftCorrectionForm, parcelForms),
    [addressForm, draftCorrectionForm, parcelForms]
  );
  const destinationCountries = useMemo(() => {
    const countries = new Map<string, string>();
    rates.forEach((rate) => countries.set(rate.countryCode, rate.countryName));
    if (addressForm.countryCode && addressForm.countryName) {
      countries.set(addressForm.countryCode, addressForm.countryName);
    }
    return [...countries].map(([code, name]) => ({ code, name }));
  }, [addressForm.countryCode, addressForm.countryName, rates]);

  const fieldIssues = useMemo(() => {
    const issues = currentReviewIssues;

    return {
      contactName: getFieldIssue(issues, ["contact name"]),
      mobileCountryCode: getFieldIssue(issues, ["mobile country code"]),
      mobileNumber: getFieldIssue(issues, ["mobile number", "valid uk mobile"]),
      email: getFieldIssue(issues, ["valid email"]),
      addressLine1: getFieldIssue(issues, ["address line 1"]),
      townOrCity: getFieldIssue(issues, ["town or city"]),
      postcode: getFieldIssue(issues, ["postcode"]),
    };
  }, [currentReviewIssues]);

  function getParcelFieldIssue(index: number, patterns: string[]) {
    const parcelLabel = `parcel ${index + 1}`;
    return currentReviewIssues.find((issue) => {
      const normalizedIssue = issue.toLowerCase();
      return normalizedIssue.includes(parcelLabel)
        && patterns.some((pattern) => normalizedIssue.includes(pattern));
    });
  }

  function syncDraftCorrectionForm(nextDraft: ShipmentDraft) {
    setDraftCorrectionForm({
      companyName: nextDraft.consigneeEnteredAddress.companyName ?? "",
      contactName: nextDraft.consigneeEnteredAddress.contactName ?? "",
      email: nextDraft.consigneeEnteredAddress.email ?? "",
      mobileCountryCode: nextDraft.consigneeEnteredAddress.mobileCountryCode ?? "",
      mobileNumber: nextDraft.consigneeEnteredAddress.mobileNumber ?? "",
      deliveryInstructions: nextDraft.consigneeEnteredAddress.deliveryInstructions ?? "",
      serviceType: nextDraft.serviceType ?? "COURIER",
      serviceCode: nextDraft.serviceCode ?? ""
    });
    setParcelForms(normalizeParcelForms(nextDraft.parcelList));
  }

  function syncAddressForm(nextDraft: ShipmentDraft) {
    const address = nextDraft.consigneeValidatedAddress ?? nextDraft.consigneeSelectedAddress ?? nextDraft.consigneeEnteredAddress;
    setAddressForm({
      countryCode: address.countryCode ?? "GB",
      countryName: address.countryName ?? getCountryName(address.countryCode ?? "GB"),
      addressLine1: address.addressLine1 ?? "",
      addressLine2: address.addressLine2 ?? "",
      townOrCity: address.townOrCity ?? "",
      county: address.county ?? "",
      postcode: address.postcode ?? ""
    });
    setAddressQuery(address.postcode ?? "");
  }

  useEffect(() => {
    if (!user || !params.draftId) return;

    async function loadDraft() {
      setError("");

      try {
        const [data, rateData] = await Promise.all([
          getShipmentDraft(params.draftId),
          listCountryRateCards()
        ]);
        if (data.shipmentDraft.bookingState && data.shipmentDraft.bookingState !== "EDITABLE") {
          toast.info("This shipment is already locked for booking. Opening its shipment details.");
          router.replace(`/dashboard/shipments/${data.shipmentDraft._id}`);
          return;
        }
        setRates(rateData.rates);
        setDraft(data.shipmentDraft);
        syncDraftCorrectionForm(data.shipmentDraft);
        syncAddressForm(data.shipmentDraft);

        const shipmentData = await listDpdShipments(100);
        const existingShipment = shipmentData.shipments.find((item) => item.shipmentDraft?.id === params.draftId);
        setResult(existingShipment ? shipmentHistoryToResult(existingShipment) : null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment draft.");
      }
    }

    void loadDraft();
  }, [params.draftId, router, user]);

  function handleAddressFieldChange(field: keyof AddressForm) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setAddressForm((current) => ({
        ...current,
        [field]: field === "postcode" ? event.target.value.toUpperCase() : event.target.value
      }));
      setManualAddressConfirmationRequired(false);
      setReviewIssues([]);
    };
  }

  function handleDestinationCountryChange(event: ChangeEvent<HTMLSelectElement>) {
    const countryCode = event.target.value;
    const countryName = destinationCountries.find((country) => country.code === countryCode)?.name
      ?? getCountryName(countryCode);
    setAddressForm((current) => ({
      ...current,
      countryCode,
      countryName
    }));
    setManualAddressConfirmationRequired(false);
    setReviewIssues([]);
  }

  function handleCorrectionFieldChange(field: keyof DraftCorrectionForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setDraftCorrectionForm((current) => ({
        ...current,
        [field]: event.target.value
      }));
      setReviewIssues([]);
    };
  }

  function handleParcelFieldChange(index: number, field: keyof Omit<ParcelForm, "sequence">) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setParcelForms((current) => current.map((parcel, parcelIndex) => (
        parcelIndex === index ? { ...parcel, [field]: event.target.value as ParcelForm[typeof field] } : parcel
      )));
      setReviewIssues([]);
    };
  }

  function handleParcelCountChange(event: ChangeEvent<HTMLInputElement>) {
    const nextCount = Number(event.target.value);
    if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > maxParcelCount) return;

    setParcelForms((current) => {
      if (nextCount > current.length) {
        return [
          ...current,
          ...Array.from({ length: nextCount - current.length }, (_, index) => (
            createEmptyParcelForm(current.length + index + 1)
          ))
        ];
      }

      const removedParcels = current.slice(nextCount);
      if (removedParcels.some((parcel) => !isParcelFormEmpty(parcel))) {
        const confirmed = window.confirm(`Reducing the parcel count will remove the details entered for Parcel ${nextCount + 1} to Parcel ${current.length}.`);
        if (!confirmed) return current;
      }

      return current.slice(0, nextCount).map((parcel, index) => ({ ...parcel, sequence: index + 1 }));
    });
    setReviewIssues([]);
  }

  async function saveDraftCorrectionsIfNeeded(): Promise<ShipmentDraft> {
    if (!draft) throw new Error("Shipment draft is not loaded.");
    if (!draftChanged) return draft;

    const data = await updateShipmentDraft(draft._id, {
      consigneeEnteredAddress: {
        companyName: draftCorrectionForm.companyName,
        contactName: draftCorrectionForm.contactName,
        email: draftCorrectionForm.email,
        mobileCountryCode: draftCorrectionForm.mobileCountryCode,
        mobileNumber: draftCorrectionForm.mobileNumber,
        countryCode: addressForm.countryCode,
        countryName: addressForm.countryName || getCountryName(addressForm.countryCode),
        addressLine1: addressForm.addressLine1,
        addressLine2: addressForm.addressLine2,
        townOrCity: addressForm.townOrCity,
        county: addressForm.county,
        postcode: addressForm.postcode,
        deliveryInstructions: draftCorrectionForm.deliveryInstructions
      },
      // The backend stores PCS from parcelList.length, so the UI submits parcels as the source of truth.
      parcelList: parcelForms.map((parcel, index) => ({
        sequence: index + 1,
        weightKg: Number(parcel.weightKg),
        lengthCm: parcel.lengthCm ? Number(parcel.lengthCm) : undefined,
        widthCm: parcel.widthCm ? Number(parcel.widthCm) : undefined,
        heightCm: parcel.heightCm ? Number(parcel.heightCm) : undefined,
        shipmentContentType: parcel.shipmentContentType,
        contentsDescription: parcel.contentsDescription,
        shipmentReference1: parcel.shipmentReference1,
        shipmentReference2: parcel.shipmentReference2
      })),
      serviceType: draftCorrectionForm.serviceType,
      serviceCode: draftCorrectionForm.serviceCode
    });

    setDraft(data.shipmentDraft);
    syncDraftCorrectionForm(data.shipmentDraft);
    syncAddressForm(data.shipmentDraft);

    return data.shipmentDraft;
  }

  async function handleSaveCorrections() {
    if (!draft || !draftChanged) return;

    setBusy(true);
    setError("");
    setReviewIssues([]);

    try {
      const preflightIssues = getReviewFormIssues(addressForm, draftCorrectionForm, parcelForms);
      if (preflightIssues.length) {
        setSubmitAttempted(true);
        setReviewIssues(preflightIssues);
        setError("Correct the highlighted details before saving.");
        return;
      }

      await saveDraftCorrectionsIfNeeded();
      setSubmitAttempted(false);
      toast.success("Shipment draft saved.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Shipment changes could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddressSearch() {
    if (!addressQuery.trim()) return;
    if (addressForm.countryCode !== "GB") {
      toast.info("Address search is available for United Kingdom destinations. Confirm other addresses manually before booking.");
      return;
    }

    setAddressBusy(true);
    setError("");
    setReviewIssues([]);

    try {
      const data = await autocompleteAddress(addressQuery);
      setPredictions(data.predictions);
    } catch (caughtError) {
      setPredictions([]);
      setError(caughtError instanceof Error ? caughtError.message : "No matching UK address was found.");
    } finally {
      setAddressBusy(false);
    }
  }

  async function handleSelectPrediction(prediction: AddressPrediction) {
    if (!draft) return;

    setAddressBusy(true);
    setError("");
    setReviewIssues([]);

    try {
      const data = await getPlaceAddress(prediction.placeId, draft._id);
      setAddressForm((current) => ({
        ...current,
        addressLine1: data.place.address.addressLine1 || current.addressLine1,
        addressLine2: data.place.address.addressLine2 || current.addressLine2,
        townOrCity: data.place.address.townOrCity || current.townOrCity,
        county: data.place.address.county || current.county,
        postcode: data.place.address.postcode || current.postcode
      }));
      setPredictions([]);
      const refreshed = await getShipmentDraft(draft._id);
      setDraft(refreshed.shipmentDraft);
      syncAddressForm(refreshed.shipmentDraft);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to select address.");
    } finally {
      setAddressBusy(false);
    }
  }

  async function handleCreateLabel(bookingProvider: "DPD" | "SWIFTLINE" = "DPD") {
    if (!draft) return;

    setBusy(true);
    setError("");
    setReviewIssues([]);

    try {
      const preflightIssues = getReviewFormIssues(addressForm, draftCorrectionForm, parcelForms);
      if (preflightIssues.length) {
        setSubmitAttempted(true);
        setReviewIssues(preflightIssues);
        setError("Correct the highlighted details before creating the shipment.");
        return;
      }
      if (chargeEstimate.missingRate) {
        const message = `Rates are not available for ${addressForm.countryName || addressForm.countryCode} with ${draftCorrectionForm.serviceType === "CARGO" ? "Cargo" : "Courier"} service. Please contact the assigned branch to arrange this shipment.`;
        setError(message);
        toast.error(message);
        return;
      }

      const savedDraft = await saveDraftCorrectionsIfNeeded();
      let draftForValidation = savedDraft;

      // Address validation is automatic here because the standalone button was removed from the review flow.
      if (draftForValidation.addressValidationStatus !== "VALIDATED") {
        const addressValidation = await validateAddress({
          shipmentDraftId: draftForValidation._id,
          address: {
            ...addressForm,
            countryCode: addressForm.countryCode,
            countryName: addressForm.countryName
          }
        });
        if (addressValidation.validation.outcome !== "VALID") {
          setManualAddressConfirmationRequired(true);
          toast.info("No automatic address match was found. Review the address and confirm it as entered.");
          return;
        }
        const refreshed = await getShipmentDraft(draftForValidation._id);
        draftForValidation = refreshed.shipmentDraft;
        setDraft(draftForValidation);
        syncDraftCorrectionForm(draftForValidation);
        syncAddressForm(draftForValidation);
      }

      const validation = await validateShipmentDraft(draftForValidation._id);
      setDraft(validation.shipmentDraft);
      syncDraftCorrectionForm(validation.shipmentDraft);

      if (!validation.readyForDpd) {
        const message = formatShipmentValidationIssues(validation.validationIssues)
          || "Correct the highlighted details before creating the shipment.";
        toast.error(message);
        return;
      }

      const data = bookingProvider === "DPD"
        ? await createDpdLabel(draftForValidation._id)
        : await createSwiftlineShipment(draftForValidation._id);
      setResult(data);
      toast.success(data.reused ? "Existing booked shipment opened." : "Shipment booked successfully.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Shipment could not be created.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmEnteredAddress() {
    if (!draft) return;

    setBusy(true);
    try {
      const data = await confirmAddress({
        shipmentDraftId: draft._id,
        decision: "KEEP_ENTERED"
      });
      setDraft(data.shipmentDraft);
      syncDraftCorrectionForm(data.shipmentDraft);
      syncAddressForm(data.shipmentDraft);
      setManualAddressConfirmationRequired(false);
      toast.success("Address confirmed. You can now create the shipment.");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Address could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Review Shipment</h1>
          <p className="mt-1 text-sm text-slate-500">Confirm consignee, destination, parcel, and charge details before booking.</p>
        </div>
        <Link href="/dashboard/dpd-labels" className="text-sm font-semibold text-blue-900 hover:text-blue-700">
          Back to Upload
        </Link>
      </div>

      {error ? (
        <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {!draft ? (
        <div className="border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading draft...</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-slate-500">Consignee Details</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <SourceBadge>From invoice</SourceBadge>
                    {draftChanged ? <SourceBadge>Manually changed</SourceBadge> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveCorrections}
                  disabled={busy || !draftChanged}
                  className="inline-flex h-9 items-center justify-center gap-2 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <FiSave aria-hidden="true" className="h-4 w-4" />
                  Save
                </button>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <ShipmentTextField label="Consignee Company" value={draftCorrectionForm.companyName} onChange={handleCorrectionFieldChange("companyName")} />
                <ShipmentTextField label="Consignee Contact Name" required value={draftCorrectionForm.contactName} onChange={handleCorrectionFieldChange("contactName")} error={fieldIssues.contactName} revealError={submitAttempted} />
                <ShipmentTextField label="Consignee Email" type="email" value={draftCorrectionForm.email} onChange={handleCorrectionFieldChange("email")} error={fieldIssues.email} revealError={submitAttempted} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <ShipmentPhoneCodeField
                    value={draftCorrectionForm.mobileCountryCode}
                    onChange={(value) => {
                      setDraftCorrectionForm((current) => ({ ...current, mobileCountryCode: value }));
                      setReviewIssues([]);
                    }}
                    error={fieldIssues.mobileCountryCode}
                    revealError={submitAttempted}
                  />
                  <ShipmentTextField label="Mobile Number" required type="tel" inputMode="tel" value={draftCorrectionForm.mobileNumber} onChange={handleCorrectionFieldChange("mobileNumber")} error={fieldIssues.mobileNumber} revealError={submitAttempted} />
                </div>
                <label className="block md:col-span-2">
                  <ShipmentFieldLabel>Delivery Instructions</ShipmentFieldLabel>
                  <textarea
                    value={draftCorrectionForm.deliveryInstructions}
                    onChange={handleCorrectionFieldChange("deliveryInstructions")}
                    rows={3}
                    className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
            </section>

            <section className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold uppercase text-slate-500">Address Search</h2>
              </div>
              <div className="space-y-4 p-4">
                {addressForm.countryCode === "GB" ? <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="block">
                    <ShipmentFieldLabel>UK Postcode Search</ShipmentFieldLabel>
                    <input
                      value={addressQuery}
                      onChange={(event) => setAddressQuery(event.target.value.toUpperCase())}
                      placeholder=" POST CODE AB10 6DN"
                      className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleAddressSearch}
                    disabled={addressBusy}
                    className="mt-2 inline-flex h-10 items-center justify-center gap-2 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    <FiSearch aria-hidden="true" className="h-4 w-4" />
                    Search
                  </button>
                </div> : null}

                {predictions.length ? (
                  <div className="max-h-[340px] overflow-y-auto border border-slate-200 [scrollbar-width:thin] [scrollbar-color:#94a3b8_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400">
                    {predictions.map((prediction) => (
                      <button
                        key={prediction.placeId}
                        type="button"
                        onClick={() => handleSelectPrediction(prediction)}
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left last:border-b-0 hover:bg-blue-50"
                      >
                        <FiMapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-900" />
                        <span>
                          <span className="block text-sm font-semibold text-slate-950">
                            {prediction.mainText || prediction.text}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {prediction.secondaryText || prediction.text}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {manualAddressConfirmationRequired ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-950">No automatic address match was found.</p>
                      <p className="mt-1 text-sm text-amber-800">Review the delivery address below before confirming it as entered.</p>
                    </div>
                    <button type="button" onClick={handleConfirmEnteredAddress} disabled={busy} className="inline-flex h-10 items-center justify-center bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-400">
                      Use Address As Entered
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <ShipmentSelectField label="Destination Country" required value={addressForm.countryCode} onChange={handleDestinationCountryChange} error={getFieldIssue(currentReviewIssues, ["country is required"])} revealError={submitAttempted} flagCountryCode={addressForm.countryCode}>
                      <option value="" disabled>Select destination country</option>
                      {destinationCountries.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                  </ShipmentSelectField>
                  <ShipmentTextField label="Delivery Address Line 1" required value={addressForm.addressLine1} onChange={handleAddressFieldChange("addressLine1")} error={fieldIssues.addressLine1} revealError={submitAttempted} />
                  <ShipmentTextField label="Delivery Address Line 2" value={addressForm.addressLine2} onChange={handleAddressFieldChange("addressLine2")} />
                  <ShipmentTextField label="Delivery Town / City" required value={addressForm.townOrCity} onChange={handleAddressFieldChange("townOrCity")} error={fieldIssues.townOrCity} revealError={submitAttempted} />
                  <ShipmentTextField label="Delivery State / County" value={addressForm.county} onChange={handleAddressFieldChange("county")} />
                  <ShipmentTextField label="Delivery Postcode" required value={addressForm.postcode} onChange={handleAddressFieldChange("postcode")} error={fieldIssues.postcode} revealError={submitAttempted} />
                </div>
              </div>
            </section>

            <section className="border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-slate-500">Parcel Details</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <SourceBadge>From invoice</SourceBadge>
                    <SourceBadge>Account default</SourceBadge>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveCorrections}
                  disabled={busy || !draftChanged}
                  className="inline-flex h-9 items-center justify-center gap-2 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <FiSave aria-hidden="true" className="h-4 w-4" />
                  Save
                </button>
              </div>
              <div className="space-y-4 p-4">
                <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                  <label className="block">
                    <ShipmentFieldLabel required>Number of Boxes</ShipmentFieldLabel>
                    <input
                      type="number"
                      min="1"
                      max={maxParcelCount}
                      step="1"
                      value={parcelForms.length}
                      onChange={handleParcelCountChange}
                      className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="grid gap-3 border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <span className="block text-xs font-semibold uppercase text-slate-500">Total Parcels</span>
                      <span className="mt-1 block font-semibold text-slate-950">{parcelForms.length}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-slate-500">Total Weight</span>
                      <span className="mt-1 block font-semibold text-slate-950">
                        {parcelForms.reduce((total, parcel) => total + (Number(parcel.weightKg) || 0), 0).toFixed(2)} kg
                      </span>
                    </div>
                  </div>
                </div>

                {parcelForms.map((parcel, index) => (
                  <div key={parcel.sequence} className="border border-slate-200">
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                      Parcel {index + 1} of {parcelForms.length}
                    </div>
                    <div className="grid gap-4 p-3 md:grid-cols-4">
                      <ShipmentTextField label="Actual Weight KG" required type="number" inputMode="decimal" value={parcel.weightKg} onChange={handleParcelFieldChange(index, "weightKg")} error={getParcelFieldIssue(index, ["weight"])} revealError={submitAttempted} />
                      <ShipmentTextField label="Length CM" required type="number" inputMode="decimal" value={parcel.lengthCm} onChange={handleParcelFieldChange(index, "lengthCm")} error={getParcelFieldIssue(index, ["length"])} revealError={submitAttempted} />
                      <ShipmentTextField label="Width CM" required type="number" inputMode="decimal" value={parcel.widthCm} onChange={handleParcelFieldChange(index, "widthCm")} error={getParcelFieldIssue(index, ["width"])} revealError={submitAttempted} />
                      <ShipmentTextField label="Height CM" required type="number" inputMode="decimal" value={parcel.heightCm} onChange={handleParcelFieldChange(index, "heightCm")} error={getParcelFieldIssue(index, ["height"])} revealError={submitAttempted} />
                      <ShipmentSelectField label="Content Type" required value={parcel.shipmentContentType} onChange={handleParcelFieldChange(index, "shipmentContentType")} error={getParcelFieldIssue(index, ["content type"])} revealError={submitAttempted}>
                          {shipmentContentTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </ShipmentSelectField>
                      <div className="md:col-span-2">
                        <ShipmentTextField label="Contents Description" required value={parcel.contentsDescription} onChange={handleParcelFieldChange(index, "contentsDescription")} error={getParcelFieldIssue(index, ["contents description"])} revealError={submitAttempted} />
                      </div>
                      <ShipmentTextField label="Reference (Optional)" value={parcel.shipmentReference1} onChange={handleParcelFieldChange(index, "shipmentReference1")} />
                    </div>
                  </div>
                ))}

                <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Enter the actual parcel contents. Incorrect or mismatched descriptions may result in inspection and additional penalty charges.
                </p>

                <div className="grid gap-4 md:grid-cols-2">
                  <ShipmentSelectField label="Service Type" required value={draftCorrectionForm.serviceType} onChange={handleCorrectionFieldChange("serviceType")}>
                      <option value="COURIER">Courier</option>
                      <option value="CARGO">Cargo</option>
                  </ShipmentSelectField>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="border border-slate-200 bg-white p-4">
              <button
                type="button"
                onClick={() => void handleCreateLabel("DPD")}
                disabled={busy}
                className="inline-flex h-10 w-full items-center justify-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <FiTruck aria-hidden="true" className="h-4 w-4" />
                {busy ? "Creating..." : "Create Shipment"}
              </button>
              <button
                type="button"
                onClick={() => void handleCreateLabel("SWIFTLINE")}
                disabled={busy}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 border border-blue-900 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
              >
                <FiTruck aria-hidden="true" className="h-4 w-4" />
                {busy ? "Creating..." : "Create Without DPD Label"}
              </button>
              <div className="mt-4 border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-600">Service</span>
                  <span className="font-semibold text-slate-950">{formatCountryRateService(draftCorrectionForm.serviceType)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-600">Destination</span>
                  <span className="font-semibold text-slate-950"> {addressForm.countryName}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  {/* <span className="font-semibold text-slate-600">Volumetric Divisor</span> */}
                  {/* <span className="font-semibold text-slate-950">{getVolumetricDivisor(draftCorrectionForm.serviceType)}</span> */}
                </div>
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 ">
                  {chargeEstimate.parcels.map((parcel, index) => (
                    <div key={index} className="text-xs text-slate-600 leading-5.5">
                      <p className="font-semibold text-slate-900">
                        Box {index + 1}: {parcel.chargeableWeightKg.toFixed(2)} kg chargeable
                      </p>
                      <p>Actual {parcel.actualWeightKg.toFixed(2)} kg / Volumetric {parcel.volumetricWeightKg.toFixed(2)} kg</p>
                      <p>{parcel.rate ? `${formatMoney(parcel.rate.chargesPerKg)} / KG` : "No matching rate slab"}</p>
                      {parcel.exceedsMaxBoxKg && parcel.rate ? (
                        <p className="mt-1 font-semibold text-amber-700">
                          Max box weight limit is {parcel.rate.maxBoxKg} KG. Estimated charges are still calculated.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-600">GST 18%</span>
                    <span className="font-semibold text-slate-950">{formatMoney(chargeEstimate.gstAmount)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-base">
                    <span className="font-semibold text-slate-950">Total Charges incl. GST</span>
                    <span className="font-bold text-blue-900">{formatMoney(chargeEstimate.totalAmount)}</span>
                  </div>
                  {chargeEstimate.missingRate ? (
                    <p className="mt-2 text-xs font-semibold text-red-700">Add a matching country rate card slab to calculate all boxes.</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 border border-amber-200 bg-amber-50 p-3">
                <h3 className="text-sm font-semibold text-amber-900">Prohibited Items Reminder</h3>
                <ul className="mt-2 text-xs font-medium text-amber-800">
                  {prohibitedItems.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>
            </section>

            {result ? (
              <section className="border border-emerald-200 bg-emerald-50">
                <div className="flex items-start gap-3 border-b border-emerald-200 px-4 py-4">
                  <FiCheckCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-emerald-950">Shipment Booked</h2>
                    <p className="mt-1 text-sm text-emerald-800">
                      {result.reused ? "This shipment was already booked. Its documents are ready below." : "The shipment, invoice, and parcel labels are ready."}
                    </p>
                  </div>
                </div>
                <dl className="grid gap-px bg-emerald-200 sm:grid-cols-2">
                  <ResultValue className="sm:col-span-2" label="Swiftline Tracking" value={result.bookingConfirmation?.swiftlineTrackingNumber ?? result.dpdShipment.swiftlineTrackingNumber} />
                  <ResultValue className="sm:col-span-2" label="Carrier Shipment" value={result.bookingConfirmation?.carrierShipmentId ?? result.dpdShipment.dpdShipmentId} />
                  <ResultValue label="Parcels" value={result.bookingConfirmation
                    ? `${result.bookingConfirmation.parcelCount} / ${result.bookingConfirmation.totalActualWeightKg.toFixed(2)} kg`
                    : String(result.dpdShipment.parcelNumbers.length)} />
                  <ResultValue label="Total Charge" value={result.bookingConfirmation ? formatMoney(result.bookingConfirmation.totalAmountMinor / 100) : result.shipmentInvoice ? formatMoney(result.shipmentInvoice.totalAmountMinor / 100) : "Pending"} />
                  <ResultValue label="Invoice" value={result.shipmentInvoice?.invoiceNumber ?? "Pending"} />
                  <ResultValue
                    label="Funding"
                    value={result.bookingConfirmation
                      ? `Advance ${formatMoney(result.bookingConfirmation.advanceAmountMinor / 100)} / Credit ${formatMoney(result.bookingConfirmation.creditAmountMinor / 100)}`
                      : "Pending"}
                  />
                </dl>

                <div className="bg-white">
                  <ShipmentLabelsPanel
                    labels={result.labels}
                    compact
                    getAccessUrl={(labelId, disposition) => getDpdLabelAccessUrl(result.dpdShipment.id, labelId, disposition)}
                  />
                </div>
                <div className="grid gap-2 border-t border-emerald-200 p-4 sm:grid-cols-3">
                  <Link
                    href={`/dashboard/shipments/${draft._id}`}
                    className="inline-flex h-10 items-center justify-center gap-2 border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:border-emerald-600"
                  >
                    <FiExternalLink aria-hidden="true" className="h-4 w-4" />
                    Open Shipment
                  </Link>
                  {result.shipmentInvoice ? (
                    <Link
                      href={`/dashboard/shipments/${draft._id}/invoice`}
                      className="inline-flex h-10 items-center justify-center gap-2 border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:border-emerald-600"
                    >
                      <FiExternalLink aria-hidden="true" className="h-4 w-4" />
                      View Invoice
                    </Link>
                  ) : null}
                  <Link
                    href="/dashboard/dpd-labels"
                    className="inline-flex h-10 items-center justify-center gap-2 border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:border-emerald-600"
                  >
                    <FiTruck aria-hidden="true" className="h-4 w-4" />
                    Create Another
                  </Link>
                </div>
              </section>
            ) : null}

          </aside>
        </div>
      )}
    </DashboardShell>
  );
}

function ResultValue({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-0 bg-white px-4 py-3 ${className}`}>
      <dt className="text-xs font-semibold uppercase text-emerald-700">{label}</dt>
      <dd className="mt-1 break-all text-sm font-semibold text-emerald-950">{value}</dd>
    </div>
  );
}
