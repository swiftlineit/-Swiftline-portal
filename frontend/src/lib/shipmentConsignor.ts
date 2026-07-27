import { isValidAadhaarNumber, normalizeAadhaarNumber } from "@/lib/aadhaar";
import { getShipmentMobileError, isAcceptableShipmentEmail } from "@/lib/shipmentContactValidation";
import type { ShipmentAddress, ShipmentConsignorAddress, ShipmentKycDocuments } from "@/lib/dpdLabels";

// Consignors are always Indian senders, so these are shown read-only and are
// re-pinned by the server on every save.
export const consignorCountryCode = "IN";
export const consignorCountryName = "India";
export const consignorMobileCountryCode = "+91";

export type ConsignorForm = {
  companyName: string;
  contactName: string;
  email: string;
  mobileNumber: string;
  aadhaarNumber: string;
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
  pickupInstructions: string;
};

export function createEmptyConsignorForm(): ConsignorForm {
  return {
    companyName: "",
    contactName: "",
    email: "",
    mobileNumber: "",
    aadhaarNumber: "",
    addressLine1: "",
    addressLine2: "",
    townOrCity: "",
    county: "",
    postcode: "",
    pickupInstructions: ""
  };
}

export function consignorFormFromDraft(consignor: ShipmentConsignorAddress | undefined): ConsignorForm {
  return {
    companyName: consignor?.companyName ?? "",
    contactName: consignor?.contactName ?? "",
    email: consignor?.email ?? "",
    mobileNumber: consignor?.mobileNumber ?? "",
    aadhaarNumber: consignor?.aadhaarNumber ?? "",
    addressLine1: consignor?.addressLine1 ?? "",
    addressLine2: consignor?.addressLine2 ?? "",
    townOrCity: consignor?.townOrCity ?? "",
    county: consignor?.county ?? "",
    postcode: consignor?.postcode ?? "",
    pickupInstructions: consignor?.pickupInstructions ?? ""
  };
}

export function consignorFormsMatch(form: ConsignorForm, consignor: ShipmentConsignorAddress | undefined) {
  const current = consignorFormFromDraft(consignor);
  return (Object.keys(current) as Array<keyof ConsignorForm>).every((key) => form[key] === current[key]);
}

function comparableText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Compares the subscriber part so "+91 98…" and "098…" still read as equal. */
function comparablePhone(countryCode: string, mobileNumber: string) {
  return `${countryCode}${mobileNumber}`.replace(/\D/g, "").replace(/^0+/, "").slice(-10);
}

export type ConsigneeContact = {
  contactName: string;
  email: string;
  mobileCountryCode: string;
  mobileNumber: string;
};

export function getConsignorFormIssues(form: ConsignorForm, consignee: ConsigneeContact) {
  const issues: string[] = [];

  if (!form.contactName.trim()) issues.push("Consignor contact name is required");
  if (!form.mobileNumber.trim()) {
    issues.push("Consignor mobile number is required");
  } else if (getShipmentMobileError(consignorMobileCountryCode, form.mobileNumber)) {
    issues.push("Enter a valid consignor mobile number");
  }
  if (!form.email.trim()) {
    issues.push("Consignor email is required");
  } else if (!isAcceptableShipmentEmail(form.email)) {
    issues.push("Enter a valid consignor email address");
  }
  // Aadhaar now lives in the KYC section (shared or per parcel); see getKycIssues.
  if (!form.addressLine1.trim()) issues.push("Consignor address line 1 is required");
  if (!form.townOrCity.trim()) issues.push("Consignor town or city is required");
  if (!form.postcode.trim()) {
    issues.push("Consignor PIN code is required");
  } else if (!/^[1-9]\d{5}$/.test(form.postcode.trim())) {
    issues.push("Enter a valid 6 digit consignor PIN code");
  }

  // The consignor and the consignee must be different parties.
  const consignorName = comparableText(form.contactName);
  if (consignorName && consignorName === comparableText(consignee.contactName)) {
    issues.push("Consignor and consignee contact names must be different");
  }

  const consignorPhone = comparablePhone(consignorMobileCountryCode, form.mobileNumber);
  if (consignorPhone && consignorPhone === comparablePhone(consignee.mobileCountryCode, consignee.mobileNumber)) {
    issues.push("Consignor and consignee mobile numbers must be different");
  }

  const consignorEmail = comparableText(form.email);
  if (consignorEmail && consignorEmail === comparableText(consignee.email)) {
    issues.push("Consignor and consignee email addresses must be different");
  }

  return issues;
}

export type ParcelKycState = {
  sequence: number;
  aadhaarNumber: string;
  kycDocuments: ShipmentKycDocuments | undefined;
};

// Only the Aadhaar number and Aadhaar card are mandatory. When KYC is shared,
// one set covers every parcel; otherwise each parcel must supply its own.
export function getKycIssues(input: {
  useForAll: boolean;
  sharedAadhaar: string;
  sharedDocuments: ShipmentKycDocuments | undefined;
  parcels: ParcelKycState[];
}) {
  const issues: string[] = [];

  if (input.useForAll) {
    if (!input.sharedAadhaar.trim()) {
      issues.push("Aadhaar number is required");
    } else if (!isValidAadhaarNumber(input.sharedAadhaar)) {
      issues.push("Enter a valid 12 digit Aadhaar number");
    }
    if (!input.sharedDocuments?.aadhaar) issues.push("Upload the Aadhaar card");
    return issues;
  }

  input.parcels.forEach((parcel, index) => {
    const label = `Parcel ${index + 1}`;
    if (!parcel.aadhaarNumber.trim()) {
      issues.push(`${label}: Aadhaar number is required`);
    } else if (!isValidAadhaarNumber(parcel.aadhaarNumber)) {
      issues.push(`${label}: enter a valid 12 digit Aadhaar number`);
    }
    if (!parcel.kycDocuments?.aadhaar) issues.push(`${label}: upload the Aadhaar card`);
  });

  return issues;
}

export function consignorFormToPatch(form: ConsignorForm): Partial<ShipmentConsignorAddress> {
  return {
    companyName: form.companyName,
    contactName: form.contactName,
    email: form.email,
    mobileNumber: form.mobileNumber,
    aadhaarNumber: normalizeAadhaarNumber(form.aadhaarNumber),
    addressLine1: form.addressLine1,
    addressLine2: form.addressLine2,
    townOrCity: form.townOrCity,
    county: form.county,
    postcode: form.postcode,
    pickupInstructions: form.pickupInstructions
  };
}

export function consigneeContactFrom(address: Pick<
  ShipmentAddress,
  "contactName" | "email" | "mobileCountryCode" | "mobileNumber"
>): ConsigneeContact {
  return {
    contactName: address.contactName ?? "",
    email: address.email ?? "",
    mobileCountryCode: address.mobileCountryCode ?? "",
    mobileNumber: address.mobileNumber ?? ""
  };
}
