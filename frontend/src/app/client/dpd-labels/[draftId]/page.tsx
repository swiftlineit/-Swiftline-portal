"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { FiArrowLeft, FiMapPin, FiSave, FiSearch, FiTruck } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  ClientDashboardLoading,
  ClientDashboardShell,
  ClientShellUser
} from "@/components/client/ClientDashboardShell";
import {
  ShipmentFieldLabel,
  ShipmentPhoneCodeField,
  ShipmentSelectField,
  ShipmentTextField
} from "@/components/shipments/ShipmentFormControls";
import { ConsignorKycSection } from "@/components/shipments/ConsignorKycSection";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";
import {
  autocompleteClientAddress,
  autocompleteClientConsignorAddress,
  confirmClientAddress,
  createClientDpdLabel,
  createClientSwiftlineShipment,
  deleteClientShipmentKycDocument,
  deleteClientShipmentParcelKycDocument,
  getClientConsignorPlaceAddress,
  getClientPlaceAddress,
  getClientShipmentDraft,
  openClientShipmentKycDocument,
  openClientShipmentParcelKycDocument,
  updateClientShipmentDraft,
  uploadClientShipmentKycDocument,
  uploadClientShipmentParcelKycDocument,
  validateClientAddress
} from "@/lib/clientDashboard";
import { CountryRateCard, formatCountryRateService, getCountryFlag, listClientCountryRateCards } from "@/lib/countryRateCards";
import { findRestrictedCategories, isRestrictedDescription } from "@/lib/restrictedGoods";
import {
  getPostcodeError,
  getShipmentEmailError,
  getShipmentMobileError
} from "@/lib/shipmentContactValidation";
import {
  AddressPrediction,
  ShipmentContentType,
  ShipmentDraft,
  ShipmentKycDocuments,
  ShipmentServiceType,
  shipmentContentTypeOptions
} from "@/lib/dpdLabels";
import {
  ConsignorForm,
  ParcelKycState,
  consigneeContactFrom,
  consignorFormFromDraft,
  consignorFormToPatch,
  consignorFormsMatch,
  createEmptyConsignorForm,
  getConsignorFormIssues,
  getKycIssues
} from "@/lib/shipmentConsignor";
import { calculateShipmentEstimate, formatMoney, getVolumetricDivisor, getVolumetricFormula } from "@/lib/shipmentPricing";
import InfoTooltip from "@/components/ui/InfoTooltip";

type AddressForm = {
  countryCode: string;
  countryName: string;
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
};

type ContactForm = {
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
  aadhaarNumber: string;
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

async function loadCurrentUser() {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) return null;

  let response = await fetch(apiUrl("/api/v1/auth/me"), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) return null;
    response = await fetch(apiUrl("/api/v1/auth/me"), {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  const data = await response.json();
  return data.success ? data.user as ClientShellUser : null;
}

function createEmptyParcel(sequence: number): ParcelForm {
  return {
    sequence,
    weightKg: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    shipmentContentType: "PARCEL",
    contentsDescription: "",
    shipmentReference1: "",
    shipmentReference2: "",
    aadhaarNumber: ""
  };
}

function normalizeParcels(draft: ShipmentDraft): ParcelForm[] {
  const parcels: ShipmentDraft["parcelList"] = draft.parcelList.length
    ? draft.parcelList
    : [{ sequence: 1, weightKg: 0, shipmentContentType: "PARCEL", contentsDescription: "" }];
  return parcels.map((parcel, index) => ({
    sequence: index + 1,
    weightKg: parcel.weightKg ? String(parcel.weightKg) : "",
    lengthCm: parcel.lengthCm ? String(parcel.lengthCm) : "",
    widthCm: parcel.widthCm ? String(parcel.widthCm) : "",
    heightCm: parcel.heightCm ? String(parcel.heightCm) : "",
    shipmentContentType: parcel.shipmentContentType ?? "PARCEL",
    contentsDescription: parcel.contentsDescription ?? "",
    shipmentReference1: parcel.shipmentReference1 ?? "",
    shipmentReference2: parcel.shipmentReference2 ?? "",
    aadhaarNumber: parcel.aadhaarNumber ?? ""
  }));
}

function isParcelEmpty(parcel: ParcelForm) {
  return !parcel.weightKg && !parcel.lengthCm && !parcel.widthCm && !parcel.heightCm
    && parcel.shipmentContentType === "PARCEL"
    && !parcel.contentsDescription && !parcel.shipmentReference1 && !parcel.shipmentReference2
    && !parcel.aadhaarNumber;
}

function getReviewIssues(addressForm: AddressForm, contactForm: ContactForm, parcelForms: ParcelForm[]) {
  const issues: string[] = [];
  if (!contactForm.contactName.trim()) issues.push("Contact name is required");
  if (!contactForm.email.trim()) {
    issues.push("Email is required");
  } else {
    const emailError = getShipmentEmailError(contactForm.email);
    if (emailError) issues.push(emailError);
  }
  if (!contactForm.mobileCountryCode.trim()) issues.push("Mobile country code is required");
  if (!contactForm.mobileNumber.trim()) {
    issues.push("Mobile number is required");
  } else {
    const mobileError = getShipmentMobileError(contactForm.mobileCountryCode, contactForm.mobileNumber);
    if (mobileError) issues.push(mobileError);
  }
  if (!addressForm.countryCode.trim()) issues.push("Country is required");
  if (!addressForm.addressLine1.trim()) issues.push("Address line 1 is required");
  if (!addressForm.townOrCity.trim()) issues.push("Town or city is required");
  if (!addressForm.postcode.trim()) {
    issues.push("Postcode is required");
  } else {
    const postcodeError = getPostcodeError(addressForm.countryCode, addressForm.postcode);
    if (postcodeError) issues.push(postcodeError);
  }
  parcelForms.forEach((parcel, index) => {
    const label = `Parcel ${index + 1}`;
    const weight = Number(parcel.weightKg);
    if (!parcel.weightKg.trim() || !Number.isFinite(weight) || weight <= 0) issues.push(`${label}: weight must be greater than zero`);
    for (const [field, value] of [["length", parcel.lengthCm], ["width", parcel.widthCm], ["height", parcel.heightCm]]) {
      if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0) {
        issues.push(`${label}: ${field} must be greater than zero`);
      }
    }
    if (!parcel.shipmentContentType) issues.push(`${label}: shipment content type is required`);
    if (!parcel.contentsDescription.trim()) {
      issues.push(`${label}: contents description is required`);
    } else {
      const restricted = findRestrictedCategories(parcel.contentsDescription);
      if (restricted.length) issues.push(`${label}: ${restricted.join(", ")} is a restricted item and cannot be shipped`);
    }
  });
  return issues;
}

function findIssue(issues: string[], patterns: string[]) {
  return issues.find((issue) => patterns.every((pattern) => issue.toLowerCase().includes(pattern)));
}

export default function ClientDpdDraftReviewPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const [user, setUser] = useState<ClientShellUser | null>(null);
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
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
  const [contactForm, setContactForm] = useState<ContactForm>({
    companyName: "",
    contactName: "",
    email: "",
    mobileCountryCode: "",
    mobileNumber: "",
    deliveryInstructions: "",
    serviceType: "COURIER",
    serviceCode: ""
  });
  const [consignorForm, setConsignorForm] = useState<ConsignorForm>(createEmptyConsignorForm());
  const [kycUseForAll, setKycUseForAll] = useState(true);
  const [kycDocuments, setKycDocuments] = useState<ShipmentKycDocuments>({});
  const [parcelKyc, setParcelKyc] = useState<Record<number, ShipmentKycDocuments>>({});
  const [parcelForms, setParcelForms] = useState<ParcelForm[]>([createEmptyParcel(1)]);
  const [addressQuery, setAddressQuery] = useState("");
  const [predictions, setPredictions] = useState<AddressPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [, setReviewIssues] = useState<string[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [manualAddressConfirmationRequired, setManualAddressConfirmationRequired] = useState(false);

  const currentReviewIssues = useMemo(
    () => getReviewIssues(addressForm, contactForm, parcelForms),
    [addressForm, contactForm, parcelForms]
  );

  const consignorChanged = useMemo(
    () => (draft
      ? !consignorFormsMatch(consignorForm, draft.consignorAddress)
        || kycUseForAll !== (draft.kycUseForAllParcels ?? true)
      : false),
    [consignorForm, draft, kycUseForAll]
  );
  const consignorReviewIssues = useMemo(
    () => getConsignorFormIssues(consignorForm, consigneeContactFrom(contactForm)),
    [consignorForm, contactForm]
  );
  const consignorFieldIssues = useMemo(() => ({
    contactName: findIssue(consignorReviewIssues, ["consignor contact name"]) ?? findIssue(consignorReviewIssues, ["contact names must"]),
    email: findIssue(consignorReviewIssues, ["consignor email"]) ?? findIssue(consignorReviewIssues, ["email addresses must"]),
    mobileNumber: findIssue(consignorReviewIssues, ["consignor mobile"]) ?? findIssue(consignorReviewIssues, ["mobile numbers must"]),
    aadhaarNumber: findIssue(consignorReviewIssues, ["aadhaar"]),
    addressLine1: findIssue(consignorReviewIssues, ["consignor address line 1"]),
    townOrCity: findIssue(consignorReviewIssues, ["consignor town"]),
    postcode: findIssue(consignorReviewIssues, ["pin code"])
  }), [consignorReviewIssues]);

  const consignorKycApi = useMemo(() => ({
    autocompleteConsignorAddress: autocompleteClientConsignorAddress,
    getConsignorPlaceAddress: getClientConsignorPlaceAddress,
    uploadKycDocument: uploadClientShipmentKycDocument,
    deleteKycDocument: deleteClientShipmentKycDocument,
    openKycDocument: openClientShipmentKycDocument,
    uploadParcelKycDocument: uploadClientShipmentParcelKycDocument,
    deleteParcelKycDocument: deleteClientShipmentParcelKycDocument,
    openParcelKycDocument: openClientShipmentParcelKycDocument
  }), []);

  const parcelKycStates = useMemo<ParcelKycState[]>(
    () => parcelForms.map((parcel) => ({
      sequence: parcel.sequence,
      aadhaarNumber: parcel.aadhaarNumber,
      kycDocuments: parcelKyc[parcel.sequence]
    })),
    [parcelForms, parcelKyc]
  );
  const destinationCountries = useMemo(() => {
    const countries = new Map<string, string>();
    rates.forEach((rate) => countries.set(rate.countryCode, rate.countryName));
    if (addressForm.countryCode && addressForm.countryName) {
      countries.set(addressForm.countryCode, addressForm.countryName);
    }
    return [...countries].map(([code, name]) => ({ code, name }));
  }, [addressForm.countryCode, addressForm.countryName, rates]);
  const totalWeight = parcelForms.reduce((total, parcel) => total + (Number(parcel.weightKg) || 0), 0);
  const chargeEstimate = useMemo(() => calculateShipmentEstimate({
    parcels: parcelForms,
    rates,
    countryCode: addressForm.countryCode,
    serviceType: contactForm.serviceType
  }), [addressForm.countryCode, contactForm.serviceType, parcelForms, rates]);

  const draftChanged = useMemo(() => {
    if (!draft) return false;
    return consignorChanged
      || JSON.stringify(parcelForms) !== JSON.stringify(normalizeParcels(draft))
      || contactForm.companyName !== (draft.consigneeEnteredAddress.companyName ?? "")
      || contactForm.contactName !== (draft.consigneeEnteredAddress.contactName ?? "")
      || contactForm.email !== (draft.consigneeEnteredAddress.email ?? "")
      || contactForm.mobileCountryCode !== (draft.consigneeEnteredAddress.mobileCountryCode ?? "")
      || contactForm.mobileNumber !== (draft.consigneeEnteredAddress.mobileNumber ?? "")
      || contactForm.deliveryInstructions !== (draft.consigneeEnteredAddress.deliveryInstructions ?? "")
      || contactForm.serviceType !== (draft.serviceType ?? "COURIER")
      || contactForm.serviceCode !== (draft.serviceCode ?? "")
      || addressForm.countryCode !== (draft.consigneeEnteredAddress.countryCode ?? "GB")
      || addressForm.addressLine1 !== (draft.consigneeEnteredAddress.addressLine1 ?? "")
      || addressForm.addressLine2 !== (draft.consigneeEnteredAddress.addressLine2 ?? "")
      || addressForm.townOrCity !== (draft.consigneeEnteredAddress.townOrCity ?? "")
      || addressForm.county !== (draft.consigneeEnteredAddress.county ?? "")
      || addressForm.postcode !== (draft.consigneeEnteredAddress.postcode ?? "");
  }, [addressForm, consignorChanged, contactForm, draft, parcelForms]);

  function syncDraft(nextDraft: ShipmentDraft) {
    const address = nextDraft.consigneeEnteredAddress;
    setDraft(nextDraft);
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
    setContactForm({
      companyName: address.companyName ?? "",
      contactName: address.contactName ?? "",
      email: address.email ?? "",
      mobileCountryCode: address.mobileCountryCode ?? "",
      mobileNumber: address.mobileNumber ?? "",
      deliveryInstructions: address.deliveryInstructions ?? "",
      serviceType: nextDraft.serviceType ?? "COURIER",
      serviceCode: nextDraft.serviceCode ?? ""
    });
    setConsignorForm(consignorFormFromDraft(nextDraft.consignorAddress));
    setKycUseForAll(nextDraft.kycUseForAllParcels ?? true);
    setKycDocuments(nextDraft.kycDocuments ?? {});
    const parcelKycBySequence: Record<number, ShipmentKycDocuments> = {};
    nextDraft.parcelList.forEach((parcel) => {
      if (parcel.kycDocuments) parcelKycBySequence[parcel.sequence] = parcel.kycDocuments;
    });
    setParcelKyc(parcelKycBySequence);
    setParcelForms(normalizeParcels(nextDraft));
  }

  useEffect(() => {
    let mounted = true;

    async function loadDraft() {
      setLoading(true);
      setError("");

      try {
        const currentUser = await loadCurrentUser();
        if (!currentUser) {
          await logout();
          router.replace("/");
          return;
        }

        if (currentUser.role !== "client") {
          router.replace("/dashboard");
          return;
        }

        const [data, rateData] = await Promise.all([
          getClientShipmentDraft(params.draftId),
          listClientCountryRateCards()
        ]);
        if (!mounted) return;

        if (data.shipmentDraft.bookingState && data.shipmentDraft.bookingState !== "EDITABLE") {
          toast.info("This shipment is already locked for booking. Opening its shipment details.");
          router.replace(`/client/shipments/${data.shipmentDraft._id}`);
          return;
        }

        setUser(currentUser);
        setRates(rateData.rates);
        syncDraft(data.shipmentDraft);
      } catch (caughtError) {
        if (!mounted) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment draft.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadDraft();
    return () => {
      mounted = false;
    };
  }, [params.draftId, router]);

  function handleContactChange(field: keyof ContactForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setContactForm((current) => ({ ...current, [field]: event.target.value }));
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

  function handleAddressChange(field: keyof AddressForm) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setAddressForm((current) => ({
        ...current,
        [field]: field === "postcode" ? event.target.value.toUpperCase() : event.target.value
      }));
      if (field === "postcode") setAddressQuery(event.target.value.toUpperCase());
      setManualAddressConfirmationRequired(false);
      setReviewIssues([]);
    };
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
      const data = await autocompleteClientAddress(addressQuery);
      setPredictions(data.predictions);
    } catch (caughtError) {
      setPredictions([]);
      setError(caughtError instanceof Error ? caughtError.message : "No matching UK address was found.");
    } finally {
      setAddressBusy(false);
    }
  }

  async function handleSelectPrediction(prediction: AddressPrediction) {
    setAddressBusy(true);
    setError("");
    setReviewIssues([]);

    try {
      const data = await getClientPlaceAddress(prediction.placeId, draft?._id);
      setAddressForm((current) => ({
        countryCode: current.countryCode,
        countryName: current.countryName,
        addressLine1: data.place.address.addressLine1 || current.addressLine1,
        addressLine2: data.place.address.addressLine2 || current.addressLine2,
        townOrCity: data.place.address.townOrCity || current.townOrCity,
        county: data.place.address.county || current.county,
        postcode: data.place.address.postcode || current.postcode
      }));
      setAddressQuery(data.place.address.postcode || prediction.mainText || prediction.text);
      setPredictions([]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to select address.");
    } finally {
      setAddressBusy(false);
    }
  }

  function handleParcelChange(index: number, field: keyof Omit<ParcelForm, "sequence">) {
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
          ...Array.from({ length: nextCount - current.length }, (_, index) => createEmptyParcel(current.length + index + 1))
        ];
      }

      const removedParcels = current.slice(nextCount);
      if (removedParcels.some((parcel) => !isParcelEmpty(parcel))) {
        const confirmed = window.confirm(`Reducing the parcel count will remove the details entered for Parcel ${nextCount + 1} to Parcel ${current.length}.`);
        if (!confirmed) return current;
      }

      return current.slice(0, nextCount).map((parcel, index) => ({ ...parcel, sequence: index + 1 }));
    });
    setReviewIssues([]);
  }

  async function saveDraftChanges() {
    if (!draft) return null;

    // PCS is derived from the parcel array length on the backend.
    const data = await updateClientShipmentDraft(draft._id, {
      consignorAddress: consignorFormToPatch(consignorForm),
      kycUseForAllParcels: kycUseForAll,
      consigneeEnteredAddress: {
        companyName: contactForm.companyName,
        contactName: contactForm.contactName,
        email: contactForm.email,
        mobileCountryCode: contactForm.mobileCountryCode,
        mobileNumber: contactForm.mobileNumber,
        countryCode: addressForm.countryCode,
        countryName: addressForm.countryName,
        addressLine1: addressForm.addressLine1,
        addressLine2: addressForm.addressLine2,
        townOrCity: addressForm.townOrCity,
        county: addressForm.county,
        postcode: addressForm.postcode,
        deliveryInstructions: contactForm.deliveryInstructions
      },
      parcelList: parcelForms.map((parcel, index) => ({
        sequence: index + 1,
        weightKg: Number(parcel.weightKg),
        lengthCm: parcel.lengthCm ? Number(parcel.lengthCm) : undefined,
        widthCm: parcel.widthCm ? Number(parcel.widthCm) : undefined,
        heightCm: parcel.heightCm ? Number(parcel.heightCm) : undefined,
        shipmentContentType: parcel.shipmentContentType,
        contentsDescription: parcel.contentsDescription,
        shipmentReference1: parcel.shipmentReference1,
        shipmentReference2: parcel.shipmentReference2,
        aadhaarNumber: parcel.aadhaarNumber
      })),
      serviceType: contactForm.serviceType,
      serviceCode: contactForm.serviceCode
    });
    syncDraft(data.shipmentDraft);
    return data.shipmentDraft;
  }

  async function handleSave() {
    if (!draft || !draftChanged) return;

    const issues = [
      ...getReviewIssues(addressForm, contactForm, parcelForms),
      ...getConsignorFormIssues(consignorForm, consigneeContactFrom(contactForm))
    ];
    if (issues.length) {
      setSubmitAttempted(true);
      setReviewIssues(issues);
      setError("Correct the highlighted details before saving.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setReviewIssues([]);

    try {
      await saveDraftChanges();
      setSubmitAttempted(false);
      toast.success("Shipment draft saved.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Shipment changes could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateLabel(bookingProvider: "DPD" | "SWIFTLINE" = "DPD") {
    if (!draft) return;

    const issues = [
      ...getReviewIssues(addressForm, contactForm, parcelForms),
      ...getConsignorFormIssues(consignorForm, consigneeContactFrom(contactForm)),
      ...getKycIssues({
        useForAll: kycUseForAll,
        sharedAadhaar: consignorForm.aadhaarNumber,
        sharedDocuments: kycDocuments,
        parcels: parcelKycStates
      })
    ];
    if (issues.length) {
      setSubmitAttempted(true);
      setReviewIssues(issues);
      setError("Correct the highlighted details before creating a label.");
      return;
    }
    if (chargeEstimate.missingRate) {
      const message = `Rates are not available for ${addressForm.countryName || addressForm.countryCode} with ${contactForm.serviceType === "CARGO" ? "Cargo" : "Courier"} service. Please contact your assigned branch to arrange this shipment.`;
      setError(message);
      toast.error(message);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setReviewIssues([]);

    try {
      const currentDraft = draftChanged ? await saveDraftChanges() : draft;
      if (!currentDraft) return;

      if (currentDraft.addressValidationStatus !== "VALIDATED") {
        const addressValidation = await validateClientAddress({
          shipmentDraftId: currentDraft._id,
          address: addressForm
        });

        if (addressValidation.validation.outcome !== "VALID") {
          setManualAddressConfirmationRequired(true);
          toast.info("No automatic address match was found. Review the address and confirm it as entered.");
          return;
        }
      }

      const result = bookingProvider === "DPD"
        ? await createClientDpdLabel(currentDraft._id)
        : await createClientSwiftlineShipment(currentDraft._id);
      setNotice(result.reused ? "Existing shipment label found for this draft." : "Shipment request created.");
      toast.success(result.reused ? "Existing booked shipment opened." : "Shipment booked successfully.");
      router.push(`/client/shipments/${currentDraft._id}`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to create shipment.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmEnteredAddress() {
    if (!draft) return;

    setBusy(true);
    try {
      const data = await confirmClientAddress({
        shipmentDraftId: draft._id,
        decision: "KEEP_ENTERED"
      });
      syncDraft(data.shipmentDraft);
      setManualAddressConfirmationRequired(false);
      toast.success("Address confirmed. You can now create the shipment.");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Address could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Review Shipment Draft</h1>
            <p className="mt-1 text-sm text-slate-500">Review consignee, address, and parcel details before shipment creation is enabled.</p>
          </div>
          <Link href="/client/dpd-labels" className="inline-flex h-10 rounded-xl items-center justify-center border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-blue-900 hover:text-blue-900">
           < FiArrowLeft className="h-4 w-4 mr-2" /> Back to Upload
          </Link>
        </div>

        {error ? (
          <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        {notice ? (
          <div className="mb-5 border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">{notice}</div>
        ) : null}

        {!draft ? (
          <div className="border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">Draft not found.</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              <ConsignorKycSection
                shipmentDraftId={draft._id}
                form={consignorForm}
                onFormChange={(next) => { setConsignorForm(next); setReviewIssues([]); }}
                fieldIssues={consignorFieldIssues}
                submitAttempted={submitAttempted}
                changed={consignorChanged}
                onSave={handleSave}
                busy={busy}
                kycUseForAll={kycUseForAll}
                onKycUseForAllChange={(next) => { setKycUseForAll(next); setReviewIssues([]); }}
                sharedKycDocuments={kycDocuments}
                onSharedKycChange={setKycDocuments}
                parcels={parcelKycStates}
                savedParcelCount={draft.parcelList.length}
                onParcelAadhaarChange={(sequence, value) => {
                  setParcelForms((current) => current.map((parcel) => (
                    parcel.sequence === sequence ? { ...parcel, aadhaarNumber: value } : parcel
                  )));
                  setReviewIssues([]);
                }}
                onParcelKycChange={(sequence, documents) => setParcelKyc((current) => ({ ...current, [sequence]: documents }))}
                api={consignorKycApi}
              />

              <section className="border border-slate-200 bg-white rounded-2xl">
                <SectionHeader title="Consignee Details" onSave={handleSave} busy={busy} changed={draftChanged} />
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <ShipmentTextField label="Consignee Company" value={contactForm.companyName} onChange={handleContactChange("companyName")} />
                  <ShipmentTextField label="Consignee Contact Name" required value={contactForm.contactName} onChange={handleContactChange("contactName")} error={findIssue(currentReviewIssues, ["contact name"])} revealError={submitAttempted} />
                  <ShipmentTextField label="Consignee Email" required type="email" value={contactForm.email} onChange={handleContactChange("email")} error={findIssue(currentReviewIssues, ["email"])} revealError={submitAttempted} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ShipmentPhoneCodeField
                      value={contactForm.mobileCountryCode}
                      onChange={(value) => {
                        setContactForm((current) => ({ ...current, mobileCountryCode: value }));
                        setReviewIssues([]);
                      }}
                      error={findIssue(currentReviewIssues, ["mobile country code"])}
                      revealError={submitAttempted}
                    />
                    <ShipmentTextField label="Mobile Number" required type="tel" inputMode="tel" value={contactForm.mobileNumber} onChange={handleContactChange("mobileNumber")} error={findIssue(currentReviewIssues, ["mobile number"])} revealError={submitAttempted} />
                  </div>
                  <label className="block md:col-span-2">
                    <ShipmentFieldLabel>Delivery Instructions</ShipmentFieldLabel>
                    <textarea
                      value={contactForm.deliveryInstructions}
                      onChange={handleContactChange("deliveryInstructions")}
                      rows={3}
                      className="mt-2 w-full border rounded-2xl border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>
              </section>

              <section className="border border-slate-200 bg-white rounded-2xl">
                <SectionHeader title="Address" onSave={handleSave} busy={busy} changed={draftChanged} />
                <div className="space-y-4 p-4">
                  {addressForm.countryCode === "GB" ? <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block">
                      <ShipmentFieldLabel>UK Postcode Search</ShipmentFieldLabel>
                      <input
                        value={addressQuery}
                        onChange={(event) => setAddressQuery(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleAddressSearch();
                          }
                        }}
                        placeholder="POST CODE AB10 6DN"
                        className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAddressSearch}
                      disabled={addressBusy}
                      className="mt-6 inline-flex h-10 items-center justify-center gap-2 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
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
                    <ShipmentSelectField label="Destination Country" required value={addressForm.countryCode} onChange={handleDestinationCountryChange} error={findIssue(currentReviewIssues, ["country is required"])} revealError={submitAttempted} flagCountryCode={addressForm.countryCode}>
                      <option value="" disabled>Select destination country</option>
                      {destinationCountries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name}
                          </option>
                        ))}
                    </ShipmentSelectField>
                    <ShipmentTextField label="Delivery Address Line 1" required value={addressForm.addressLine1} onChange={handleAddressChange("addressLine1")} error={findIssue(currentReviewIssues, ["address line 1"])} revealError={submitAttempted} />
                    <ShipmentTextField label="Delivery Address Line 2" value={addressForm.addressLine2} onChange={handleAddressChange("addressLine2")} />
                    <ShipmentTextField label="Delivery Town / City" required value={addressForm.townOrCity} onChange={handleAddressChange("townOrCity")} error={findIssue(currentReviewIssues, ["town or city"])} revealError={submitAttempted} />
                    <ShipmentTextField label="Delivery State / County" value={addressForm.county} onChange={handleAddressChange("county")} />
                    <ShipmentTextField label="Delivery Postcode" required value={addressForm.postcode} onChange={handleAddressChange("postcode")} error={findIssue(currentReviewIssues, ["postcode"])} revealError={submitAttempted} />
                  </div>
                </div>
              </section>

              <section className="border border-slate-200 bg-white rounded-2xl">
                <SectionHeader title="Parcel Details" onSave={handleSave} busy={busy} changed={draftChanged} />
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
                        className="mt-2 h-10 w-full border rounded-xl border-slate-300 px-3 text-sm outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <div className="grid gap-3 border rounded-xl border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
                      <ReadOnlyDetail label="Total Parcels" value={parcelForms.length} />
                      <ReadOnlyDetail label="Total Weight" value={`${totalWeight.toFixed(2)} kg`} />
                    </div>
                  </div>

                  {parcelForms.map((parcel, index) => (
                    <div key={parcel.sequence} className="border border-slate-200">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                        Parcel {index + 1} of {parcelForms.length}
                      </div>
                      <div className="grid gap-4 p-3 md:grid-cols-4">
                        <ShipmentTextField label="Actual Weight KG" required type="number" inputMode="decimal" value={parcel.weightKg} onChange={handleParcelChange(index, "weightKg")} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "weight"])} revealError={submitAttempted} />
                        <ShipmentTextField label="Length CM" required type="number" inputMode="decimal" value={parcel.lengthCm} onChange={handleParcelChange(index, "lengthCm")} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "length"])} revealError={submitAttempted} />
                        <ShipmentTextField label="Width CM" required type="number" inputMode="decimal" value={parcel.widthCm} onChange={handleParcelChange(index, "widthCm")} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "width"])} revealError={submitAttempted} />
                        <ShipmentTextField label="Height CM" required type="number" inputMode="decimal" value={parcel.heightCm} onChange={handleParcelChange(index, "heightCm")} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "height"])} revealError={submitAttempted} />
                        <ShipmentSelectField label="Content Type" required value={parcel.shipmentContentType} onChange={handleParcelChange(index, "shipmentContentType")} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "content type"])} revealError={submitAttempted}>
                            {shipmentContentTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </ShipmentSelectField>
                        <div className="md:col-span-2">
                          <ShipmentTextField label="Contents Description" tooltip="Items/product details" required value={parcel.contentsDescription} onChange={handleParcelChange(index, "contentsDescription")} onBlur={() => { if (isRestrictedDescription(parcel.contentsDescription)) toast.error("This item is restricted."); }} error={findIssue(currentReviewIssues, [`parcel ${index + 1}`, "contents"])} revealError={submitAttempted} />
                        </div>
                        <ShipmentTextField label="Reference (Optional)" tooltip="Can be a company name or a unique identifier of the shipment" value={parcel.shipmentReference1} onChange={handleParcelChange(index, "shipmentReference1")} />
                      </div>
                    </div>
                  ))}

                  <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Enter the actual parcel contents. Incorrect or mismatched descriptions may result in inspection and additional penalty charges.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ShipmentSelectField label="Service Type" required value={contactForm.serviceType} onChange={handleContactChange("serviceType")}>
                        <option value="COURIER"> Swiftline Courier</option>
                        <option value="CARGO"> Swiftline Cargo</option>
                    </ShipmentSelectField>
                  </div>
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="border border-slate-200 bg-white p-4 rounded-2xl">
                <button
                  type="button"
                  onClick={() => void handleCreateLabel("DPD")}
                  disabled={busy}
                  className="inline-flex h-10 w-full rounded-xl items-center justify-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <FiTruck aria-hidden="true" className="h-4 w-4" />
                  {busy ? "Processing..." : "Create Shipment"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateLabel("SWIFTLINE")}
                  disabled={busy}
                  className="mt-2 inline-flex rounded-xl h-10 w-full items-center justify-center gap-2 border border-blue-900 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                >
                  <FiTruck aria-hidden="true" className="h-4 w-4" />
                  {busy ? "Processing..." : "Create Without DPD Label"}
                </button>
                <div className="mt-3 text-sm font-medium text-slate-600">
                  <p>The total shown below will be reserved from Customer Advance first, then available business credit.</p>
                </div>
                <div className="mt-4 border border-slate-400 bg-slate-50 p-3 rounded-2xl ">
                  <div className="grid gap-3 text-sm">
                    <ReadOnlyDetail label="Service" value={formatCountryRateService(contactForm.serviceType)} />
                    <ReadOnlyDetail label="Destination" value={`${getCountryFlag(addressForm.countryCode)} ${addressForm.countryName}`} />
                    <ReadOnlyDetail label="Volumetric Divisor" value={getVolumetricDivisor(contactForm.serviceType)} tooltip={getVolumetricFormula(contactForm.serviceType)} />
                  </div>
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    {chargeEstimate.parcels.map((parcel, index) => (
                      <div key={`${parcel.chargeableWeightKg}-${index}`} className="text-xs text-slate-600">
                        <p className="font-semibold text-slate-900">Box {index + 1}</p>
                        <p>Actual {parcel.actualWeightKg.toFixed(2)} kg / Volumetric {parcel.volumetricWeightKg.toFixed(2)} kg</p>
                        <p>Chargeable {parcel.chargeableWeightKg.toFixed(2)} kg x {parcel.rate ? formatMoney(parcel.rate.chargesPerKg) : "No rate"}</p>
                        {parcel.exceedsMaxBoxKg && parcel.rate ? (
                          <p className="mt-1 font-semibold text-amber-700">
                            Max box limit is {parcel.rate.maxBoxKg} kg. Estimated charges still use {parcel.chargeableWeightKg.toFixed(2)} kg.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {chargeEstimate.missingRate ? (
                    <p className="mt-3 text-xs font-semibold text-red-700">
                      No matching country rate slab found for one or more boxes.
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-semibold text-slate-950">{formatMoney(chargeEstimate.baseAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">GST 18%</span>
                      <span className="font-semibold text-slate-950">{formatMoney(chargeEstimate.gstAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                      <span className="font-semibold text-slate-950">Total Charges incl. GST</span>
                      <span className="text-base font-bold text-blue-900">{formatMoney(chargeEstimate.totalAmount)}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 border border-red-400 bg-amber-50 p-3 rounded-2xl">
 <h3 className="text-sm font-semibold text-amber-900 ">Prohibited Items Reminder</h3>
                <ul className="mt-2 text-xs font-medium text-amber-800">
                    {prohibitedItems.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </ClientDashboardShell>
  );
}

function SectionHeader({ title, onSave, busy, changed }: { title: string; onSave: () => void; busy: boolean; changed: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold uppercase text-slate-500">{title}</h2>
      <button
        type="button"
        onClick={onSave}
        disabled={busy || !changed}
        className="inline-flex h-9 items-center rounded-xl justify-center gap-2 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        <FiSave aria-hidden="true" className="h-4 w-4" />
        Save
      </button>
    </div>
  );
}

function ReadOnlyDetail({ label, value, tooltip }: { label: string; value?: string | number | null; tooltip?: string }) {
  return (
    <div>
      <span className="flex items-center gap-1 text-xs font-semibold uppercase text-slate-500">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </span>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value || "Not available"}</p>
    </div>
  );
}
