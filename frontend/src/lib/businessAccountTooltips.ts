// Help text for the business account wizard, kept in one place so the wording
// can be read and revised without going through JSX, and so the same term is
// never explained two different ways on two different steps.
//
// House style: at most two sentences. Say what the field means, what to enter,
// and- where it is not obvious- why it is being asked for. Fields whose label
// already says everything (First Name, Company Name) deliberately have no entry
// and show no icon; an icon that restates the label teaches users to ignore all
// of them.

import { BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX } from "@/lib/businessAccountContactRules";

export const contactTooltips = {
  mobileType: "Whether this is a personal mobile or a desk line. Operations use it to decide how to reach you about a shipment in transit.",
  countryCode: "Dialling code of the country the phone number belongs to. The number is validated against that country's numbering rules.",
  mobileNumber: "Enter the number without the country code, which is selected separately.",
  email: "Use your work email where possible. Personal addresses are accepted only on gmail.com, yahoo.com or outlook.com.",
  jobTitle: "Your role at the company. Pick the closest match, or choose Other to type a title that is not listed.",
  department: "The team you work in. This routes account queries to the right contact.",
  shipmentTypes: "Cargo is for heavier consolidated freight; courier is for parcels moving on an express service."
} as const;

export const companyTooltips = {
  registrationCountry: "Where the company is legally registered. This decides which registration or tax number is required and how it is validated.",
  registrationIdType: "Which of the accepted identifiers you are entering. The format checked against it changes with this choice.",
  usTaxIdType: "EIN for a business, SSN for an individual, or ITIN for an individual who is not eligible for an SSN.",
  noCompanyRegistration: "Tick only if the company genuinely has no registration number in the selected country. The account can still be submitted, but it cannot be activated until the number is supplied.",
  noCompany: "Tick if the account is for an individual rather than a registered business. Company name, address and industry are then not collected.",
  companyType: "The legal structure the company is registered as, as shown on its registration certificate.",

  gstin: "15-character GST identification number from your GST certificate. The first two digits are the state code and characters 3-12 are the company PAN.",
  gstExempt: "Tick only if the business is legally not required to register for GST. An administrator must approve the exemption before the account can be activated.",
  gstExemptReason: "State the legal basis for not holding a GSTIN, for example turnover below the registration threshold. An administrator reviews this before approving the account.",

  addressLine2: "Anything the address search cannot know: building name, floor, unit number or a nearby landmark. An address lookup never overwrites this.",
  city: "Start typing to search. If your city is not listed, type it in full- the list does not cover every town.",
  addressCountry: "Country of the company's physical address. It sets the postal code format and the list of states that are accepted.",
  operatingCountries: "Every country you ship to or from. Select as many as apply; this shapes the rates and services offered to the account.",
  useCompanyAddressAsBillingAddress: "Untick to invoice a different address, such as a head office or an accountant. Invoices for this account are issued to whichever address applies.",

  website: "Optional. Must start with http:// or https://",
  industry: "What the business does. Used to apply the right customs and restricted-goods handling to your shipments.",
  monthlyShipmentVolume: "Your expected shipment count per month. Used to size the account and set rates; it is an estimate, not a commitment.",
  requestedCreditCurrency: "The currency the credit limit and invoices for this account are denominated in.",
  requestedCreditLimit: `Optional. The credit you would like on the account, up to ${BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX}. It is subject to review and may be approved at a lower amount.`
} as const;

// Every document the wizard can collect. These are the terms most likely to
// stop someone mid-form, so each says what the document is and whether the
// account can proceed without it.
export const documentTooltips = {
  aadhaarCard: "Government photo ID of the account contact, issued by UIDAI. Required for KYC before the account can be activated.",
  panCard: "The company's Permanent Account Number card, issued by the Indian income tax department. Required for KYC and for tax reporting on invoices.",
  adCertificate: "Authorised Dealer certificate from your bank, confirming it handles your foreign exchange. Optional, but it speeds up customs clearance on export shipments.",
  msmeCertificate: "Udyam registration confirming the business qualifies as a Micro, Small or Medium Enterprise. Optional, and may qualify the account for MSME payment terms.",
  tanCertificate: "Tax Deduction and Collection Account Number certificate. Optional, and needed only if the company deducts tax at source on our invoices.",
  gstCertificate: "The GST registration certificate the GSTIN appears on. Optional, but it lets a reviewer verify the GSTIN without asking for it separately.",
  iecCertificate: "Importer Exporter Code issued by the DGFT. Optional for domestic accounts, and required before the account can clear international shipments.",
  otherCertificate: "Any other document supporting the application, such as a trade licence or an incorporation certificate.",
  fileRules: "PDF, JPG or PNG, up to 5 MB. Upload a full, readable copy- a reviewer rejects partial or blurred scans."
} as const;

export const reviewTooltips = {
  confirmation: "Confirms the details above are accurate. The account is submitted for KYC review and cannot be edited while a reviewer has it.",
  submit: "Sends the account for KYC review. A reviewer checks the details and documents before the account is approved and can start booking."
} as const;

export const sectionTooltips = {
  registration: "How the company is registered and the identifier that proves it. What is asked for here changes with the country of registration.",
  companyDetails: "The trading identity of the business, as it should appear on invoices and shipping documents.",
  companyAddress: "The company's physical address. It sets the state and postal code rules, and is used as the billing address unless you specify another.",
  additionalInformation: "Context used to size the account and set up credit. None of it changes what you can ship.",
  documents: "Identity and registration documents a reviewer checks before the account is activated. Aadhaar and PAN are mandatory; the rest support the application."
} as const;
