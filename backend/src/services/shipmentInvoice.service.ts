import mongoose from "mongoose";
import { Branch } from "../models/branch.model.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentCharge } from "../models/shipmentCharge.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { ShipmentInvoiceCounter } from "../models/shipmentInvoiceCounter.model.js";
import { formatCsbType } from "./csbType.service.js";
import { calculateShipmentPricingEstimate, type ShipmentPricingEstimate } from "./shipmentPricing.service.js";
import { readShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

export class ShipmentInvoiceServiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

function getFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

async function getNextInvoiceNumber(financialYear: string, session?: mongoose.ClientSession) {
  const counter = await ShipmentInvoiceCounter.findOneAndUpdate(
    { financialYear },
    { $inc: { sequence: 1 } },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
  ).exec();

  return `SL/${financialYear}/${String(counter.sequence).padStart(5, "0")}`;
}

function normalizeState(value?: string | null) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function getTaxAmounts(baseAmountMinor: number, taxAmountMinor: number, supplierState: string, customerState: string) {
  const isIntraState = Boolean(normalizeState(supplierState) && normalizeState(supplierState) === normalizeState(customerState));

  if (isIntraState) {
    const cgstAmountMinor = Math.floor(taxAmountMinor / 2);
    return {
      taxType: "CGST_SGST" as const,
      cgstAmountMinor,
      sgstAmountMinor: taxAmountMinor - cgstAmountMinor,
      igstAmountMinor: 0
    };
  }

  return {
    taxType: "IGST" as const,
    cgstAmountMinor: 0,
    sgstAmountMinor: 0,
    igstAmountMinor: taxAmountMinor
  };
}

function toMinor(value: number) {
  return Math.round(value * 100);
}

export function resolveShipmentInvoicePaymentAllocation(input: {
  totalAmountMinor: number;
  paymentAllocation?: { advanceAppliedMinor: number; creditOutstandingMinor: number };
  existingAllocation?: { advanceAppliedMinor: number; creditOutstandingMinor: number } | null;
  reservationAllocation?: { advanceAmountMinor: number; creditAmountMinor: number } | null;
}) {
  const advanceAppliedMinor = input.paymentAllocation?.advanceAppliedMinor
    ?? input.existingAllocation?.advanceAppliedMinor
    ?? input.reservationAllocation?.advanceAmountMinor
    ?? 0;
  const creditOutstandingMinor = input.paymentAllocation?.creditOutstandingMinor
    ?? input.existingAllocation?.creditOutstandingMinor
    ?? input.reservationAllocation?.creditAmountMinor
    ?? input.totalAmountMinor;

  if (advanceAppliedMinor + creditOutstandingMinor !== input.totalAmountMinor) {
    throw new ShipmentInvoiceServiceError("The invoice payment allocation does not match its total amount.", 409);
  }

  return { advanceAppliedMinor, creditOutstandingMinor };
}

function addressLine(parts: Array<string | undefined | null>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(", ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildRevisionSnapshot(invoice: InstanceType<typeof ShipmentInvoice>) {
  return {
    revision: invoice.revision,
    revisedAt: invoice.revisedAt ?? invoice.issuedAt,
    supplier: invoice.supplier,
    customer: invoice.customer,
    shipment: invoice.shipment,
    sacCode: invoice.sacCode,
    taxableValueMinor: invoice.taxableValueMinor,
    gstRatePercent: invoice.gstRatePercent,
    taxType: invoice.taxType,
    cgstAmountMinor: invoice.cgstAmountMinor,
    sgstAmountMinor: invoice.sgstAmountMinor,
    igstAmountMinor: invoice.igstAmountMinor,
    totalTaxAmountMinor: invoice.totalTaxAmountMinor,
    totalAmountMinor: invoice.totalAmountMinor,
    advanceAppliedMinor: invoice.advanceAppliedMinor,
    creditOutstandingMinor: invoice.creditOutstandingMinor,
    pricingSnapshot: invoice.pricingSnapshot,
    description: invoice.description,
    reverseCharge: invoice.reverseCharge,
    status: invoice.status,
    validationWarnings: invoice.validationWarnings,
    paymentStatus: invoice.paymentStatus
  };
}

export async function ensureShipmentInvoiceForDraft(input: {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  revise?: boolean;
  paymentAllocation?: {
    advanceAppliedMinor: number;
    creditOutstandingMinor: number;
  };
  pricingOverride?: ShipmentPricingEstimate;
  session?: mongoose.ClientSession;
}) {
  const existingQuery = ShipmentInvoice.findOne({ shipmentDraftId: input.shipmentDraftId });
  if (input.session) existingQuery.session(input.session);
  const existing = await existingQuery.exec();
  // Draft invoices refresh from current GST master data when they are viewed again.
  if (existing && !input.revise && existing.status === "ISSUED") return existing;

  const draftQuery = ShipmentDraft.findById(input.shipmentDraftId);
  const dpdQuery = DpdShipment.findById(input.dpdShipmentId);
  if (input.session) {
    draftQuery.session(input.session);
    dpdQuery.session(input.session);
  }
  const draft = await draftQuery.exec();
  const dpdShipment = await dpdQuery.exec();
  if (!draft || !dpdShipment) throw new ShipmentInvoiceServiceError("Booked shipment information was not found.", 404);
  // The first legal invoice must use the exact values accepted at booking.
  // Approved amendments deliberately use current draft values and create a revision.
  const bookingSnapshot = input.revise
    ? null
    : readShipmentBookingSnapshot(dpdShipment.bookingSnapshot);

  const accountQuery = BusinessAccount.findById(draft.businessAccountId);
  const branchQuery = Branch.findById(draft.branchId);
  const uploadQuery = InvoiceUpload.findById(draft.invoiceUploadId);
  const chargeQuery = ShipmentCharge.findOne({ shipmentDraftId: draft._id });
  if (input.session) {
    accountQuery.session(input.session);
    branchQuery.session(input.session);
    uploadQuery.session(input.session);
    chargeQuery.session(input.session);
  }
  const account = await accountQuery.exec();
  const branch = await branchQuery.exec();
  const upload = await uploadQuery.exec();
  const charge = await chargeQuery.exec();
  if (!account || !branch || !upload) throw new ShipmentInvoiceServiceError("Invoice master data is incomplete.", 409);

  let pricing: ShipmentPricingEstimate;
  if (input.pricingOverride) {
    pricing = input.pricingOverride;
  } else if (bookingSnapshot) {
    pricing = bookingSnapshot.pricing;
  } else if (!input.revise && charge?.customerChargeStatus === "COMPLETED" && charge.pricingSnapshot?.totalAmount) {
    pricing = charge.pricingSnapshot as unknown as ShipmentPricingEstimate;
  } else {
    pricing = await calculateShipmentPricingEstimate({
      countryCode: draft.consigneeEnteredAddress.countryCode,
      serviceType: draft.serviceType,
      parcels: draft.parcelList,
      csbType: draft.csbType,
      session: input.session
    });
  }
  if (charge?.customerChargeStatus === "COMPLETED" && toMinor(pricing.totalAmount) !== charge.customerChargeMinor) {
    throw new ShipmentInvoiceServiceError("The booked charge and invoice pricing snapshot do not match.", 409);
  }
  if (pricing.missingRate) {
    throw new ShipmentInvoiceServiceError("An applicable rate slab is required before the shipment invoice can be issued.", 409);
  }

  const reservation = charge?.balanceReservationId
    ? await BalanceReservation.findById(charge.balanceReservationId).session(input.session ?? null).exec()
    : null;
  const snapshotAllocation = bookingSnapshot
    ? {
        advanceAmountMinor: bookingSnapshot.payment.advanceAmountMinor,
        creditAmountMinor: bookingSnapshot.payment.creditAmountMinor
      }
    : null;
  const totalAmountMinor = toMinor(pricing.totalAmount);
  const { advanceAppliedMinor, creditOutstandingMinor } = resolveShipmentInvoicePaymentAllocation({
    totalAmountMinor,
    paymentAllocation: input.paymentAllocation,
    existingAllocation: existing,
    reservationAllocation: reservation ?? snapshotAllocation
  });
  const paymentStatus = creditOutstandingMinor === 0
    ? "PAID" as const
    : advanceAppliedMinor > 0 ? "PARTIALLY_PAID" as const : "UNPAID" as const;

  const snapshotSender = asRecord(bookingSnapshot?.sender);
  const snapshotSenderAddress = asRecord(snapshotSender.address);
  const snapshotSenderContact = asRecord(snapshotSender.contact);
  const snapshotAccount = asRecord(bookingSnapshot?.account);
  const snapshotCompany = asRecord(snapshotAccount.company);
  const snapshotContact = asRecord(snapshotAccount.contact);
  const snapshotConsignee = asRecord(bookingSnapshot?.consignee);
  const supplierState = asString(snapshotSenderAddress.stateOrProvince) || branch.address.stateOrProvince || "";
  const customerState = asString(snapshotCompany.stateOrProvince) || account.company.stateOrProvince || "";
  const supplierGstin = asString(snapshotSender.gstin) || branch.gstin || "";
  const customerGstin = asString(snapshotCompany.gstin) || account.company.gstin || "";
  const taxableValueMinor = toMinor(pricing.baseAmount);
  const totalTaxAmountMinor = toMinor(pricing.gstAmount);
  const supplierJurisdiction = supplierGstin.slice(0, 2) || supplierState;
  const customerJurisdiction = customerGstin.slice(0, 2) || customerState;
  const taxAmounts = getTaxAmounts(taxableValueMinor, totalTaxAmountMinor, supplierJurisdiction, customerJurisdiction);
  const validationWarnings = [
    !supplierGstin ? "Branch GSTIN is not configured." : "",
    !customerGstin ? "Customer GSTIN is not configured." : ""
  ].filter(Boolean);
  const status = validationWarnings.length ? "DRAFT" : "ISSUED";
  const supplier = {
    legalName: "Swiftline Cargo and Express Logistics Pvt. Ltd.",
    branchName: asString(snapshotSender.name) || branch.name,
    branchCode: asString(snapshotSender.code) || branch.code,
    gstin: supplierGstin,
    state: supplierState,
    stateCode: supplierGstin.slice(0, 2),
    address: addressLine([
      asString(snapshotSenderAddress.address) || branch.address.address,
      asString(snapshotSenderAddress.city) || branch.address.city,
      supplierState,
      asString(snapshotSenderAddress.postalCode) || branch.address.postalCode,
      asString(snapshotSenderAddress.countryName) || branch.address.countryName
    ]),
    email: asString(snapshotSenderContact.email) || branch.contact.email || "",
    phone: asString(snapshotSenderContact.phone) || branch.contact.phone || ""
  };
  const customer = {
    accountId: asString(snapshotAccount.accountId) || account.accountId,
    companyName: asString(snapshotCompany.companyName) || account.company.companyName,
    contactName: `${asString(snapshotContact.firstName) || account.contact.firstName} ${asString(snapshotContact.lastName) || account.contact.lastName}`.trim(),
    gstin: customerGstin,
    state: customerState,
    stateCode: customerGstin.slice(0, 2),
    billingAddress: addressLine([
      asString(snapshotCompany.registeredAddress) || account.company.registeredAddress,
      asString(snapshotCompany.city) || account.company.city,
      customerState,
      asString(snapshotCompany.postalCode) || account.company.postalCode,
      asString(snapshotCompany.addressCountry) || account.company.addressCountry
    ]),
    email: asString(snapshotContact.email) || account.contact.email,
    phone: `${asString(snapshotContact.countryCode) || account.contact.countryCode} ${asString(snapshotContact.mobileNumber) || account.contact.mobileNumber}`.trim()
  };
  const snapshotParcels = bookingSnapshot?.parcels ?? [];
  const shipmentReference = bookingSnapshot?.source.shipmentReference || upload.shipmentReference;
  const sourceInvoiceNumber = bookingSnapshot?.source.invoiceNumber || upload.invoiceNumber;
  const serviceType = bookingSnapshot?.service.type || draft.serviceType;
  const serviceCode = bookingSnapshot?.service.code || draft.serviceCode || dpdShipment.serviceCode;
  const shipment = {
    shipmentReference,
    sourceInvoiceNumber,
    dpdShipmentId: bookingSnapshot?.tracking.carrierShipmentId || dpdShipment.dpdShipmentId || "",
    serviceType,
    serviceCode,
    parcelCount: bookingSnapshot?.parcels.length || draft.parcelList.length,
    origin: addressLine([
      asString(snapshotSenderAddress.city) || branch.address.city,
      supplierState,
      asString(snapshotSenderAddress.countryName) || branch.address.countryName
    ]),
    destination: addressLine([
      asString(snapshotConsignee.townOrCity) || draft.consigneeEnteredAddress.townOrCity,
      asString(snapshotConsignee.county) || draft.consigneeEnteredAddress.county,
      asString(snapshotConsignee.countryName) || draft.consigneeEnteredAddress.countryName
    ]),
    deliveryAddress: addressLine([
      asString(snapshotConsignee.companyName) || draft.consigneeEnteredAddress.companyName,
      asString(snapshotConsignee.addressLine1) || draft.consigneeEnteredAddress.addressLine1,
      asString(snapshotConsignee.addressLine2) || draft.consigneeEnteredAddress.addressLine2,
      asString(snapshotConsignee.townOrCity) || draft.consigneeEnteredAddress.townOrCity,
      asString(snapshotConsignee.county) || draft.consigneeEnteredAddress.county,
      asString(snapshotConsignee.postcode) || draft.consigneeEnteredAddress.postcode,
      asString(snapshotConsignee.countryName) || draft.consigneeEnteredAddress.countryName
    ]),
    consigneeName: asString(snapshotConsignee.companyName) || asString(snapshotConsignee.contactName) || draft.consigneeEnteredAddress.companyName || draft.consigneeEnteredAddress.contactName || "",
    parcelNumbers: bookingSnapshot?.parcels.map((parcel) => parcel.carrierParcelNumber) || dpdShipment.parcelNumbers,
    parcels: pricing.parcels.map((pricedParcel, index) => {
      const sourceParcel = asRecord(snapshotParcels[index] ?? draft.parcelList[index]);
      return {
        ...pricedParcel,
        lengthCm: typeof sourceParcel.lengthCm === "number" ? sourceParcel.lengthCm : null,
        widthCm: typeof sourceParcel.widthCm === "number" ? sourceParcel.widthCm : null,
        heightCm: typeof sourceParcel.heightCm === "number" ? sourceParcel.heightCm : null,
        contentsDescription: asString(sourceParcel.contentsDescription) || "Shipment goods"
      };
    })
  };
  const nextValues = {
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    businessAccountId: draft.businessAccountId,
    branchId: draft.branchId,
    currency: asString(snapshotSender.baseCurrency) || branch.baseCurrency || "INR",
    supplier,
    customer,
    shipment,
    sacCode: asString(snapshotSender.invoiceSacCode) || branch.invoiceSacCode || "",
    // The CSB route is part of the invoice description so the customs category
    // this shipment was billed under is visible on the invoice record itself.
    description: `${serviceType === "CARGO" ? "Cargo" : "Courier"} shipment service (${formatCsbType(pricing.csbType)}) - ${shipmentReference}`,
    taxableValueMinor,
    gstRatePercent: pricing.gstRate * 100,
    ...taxAmounts,
    totalTaxAmountMinor,
    totalAmountMinor,
    advanceAppliedMinor,
    creditOutstandingMinor,
    paymentStatus,
    reverseCharge: false,
    status,
    validationWarnings,
    pricingSnapshot: pricing,
    updatedBy: input.userId
  };

  if (existing) {
    if (input.revise) {
      existing.revisions = [...existing.revisions, buildRevisionSnapshot(existing)];
      existing.revision += 1;
      existing.revisedAt = new Date();
    }
    existing.set(nextValues);
    await existing.save({ session: input.session });
    return existing;
  }

  const issuedAt = new Date();
  const financialYear = getFinancialYear(issuedAt);
  const invoice = new ShipmentInvoice({
    ...nextValues,
    invoiceNumber: await getNextInvoiceNumber(financialYear, input.session),
    financialYear,
    shipmentDraftId: draft._id,
    revision: 1,
    revisions: [],
    issuedAt,
    createdBy: input.userId
  });
  try {
    await invoice.save({ session: input.session });
    return invoice;
  } catch (error) {
    // Concurrent view/download requests may race on the one-invoice-per-shipment index.
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      const concurrentInvoiceQuery = ShipmentInvoice.findOne({ shipmentDraftId: draft._id });
      if (input.session) concurrentInvoiceQuery.session(input.session);
      const concurrentInvoice = await concurrentInvoiceQuery.exec();
      if (concurrentInvoice) return concurrentInvoice;
    }
    throw error;
  }
}

export function serializeShipmentInvoice(
  invoice: InstanceType<typeof ShipmentInvoice>,
  requestedRevision = invoice.revision
) {
  if (!Number.isInteger(requestedRevision) || requestedRevision < 1 || requestedRevision > invoice.revision) {
    throw new ShipmentInvoiceServiceError("Invoice revision not found.", 404);
  }

  const storedRevision = requestedRevision === invoice.revision
    ? null
    : invoice.revisions.find((candidate) => candidate.revision === requestedRevision);
  if (requestedRevision !== invoice.revision && !storedRevision) {
    throw new ShipmentInvoiceServiceError("Invoice revision not found.", 404);
  }

  const selected = storedRevision ?? invoice;
  const selectedIssuedAt = storedRevision?.revisedAt
    ?? (invoice.revision > 1 ? invoice.revisedAt ?? invoice.issuedAt : invoice.issuedAt);
  const versions = [
    ...invoice.revisions.map((revision) => ({
      revision: revision.revision,
      issuedAt: revision.revisedAt,
      totalAmountMinor: revision.totalAmountMinor,
      status: revision.status ?? invoice.status,
      paymentStatus: revision.paymentStatus ?? invoice.paymentStatus,
      isLatest: false
    })),
    {
      revision: invoice.revision,
      issuedAt: invoice.revision > 1 ? invoice.revisedAt ?? invoice.issuedAt : invoice.issuedAt,
      totalAmountMinor: invoice.totalAmountMinor,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      isLatest: true
    }
  ].sort((left, right) => left.revision - right.revision);

  return {
    id: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    financialYear: invoice.financialYear,
    shipmentDraftId: String(invoice.shipmentDraftId),
    dpdShipmentId: String(invoice.dpdShipmentId),
    businessAccountId: String(invoice.businessAccountId),
    branchId: String(invoice.branchId),
    currency: invoice.currency,
    supplier: selected.supplier,
    customer: selected.customer,
    shipment: selected.shipment,
    sacCode: selected.sacCode,
    description: storedRevision?.description ?? invoice.description,
    taxableValueMinor: selected.taxableValueMinor,
    gstRatePercent: selected.gstRatePercent,
    taxType: selected.taxType,
    cgstAmountMinor: selected.cgstAmountMinor,
    sgstAmountMinor: selected.sgstAmountMinor,
    igstAmountMinor: selected.igstAmountMinor,
    totalTaxAmountMinor: selected.totalTaxAmountMinor,
    totalAmountMinor: selected.totalAmountMinor,
    advanceAppliedMinor: selected.advanceAppliedMinor,
    creditOutstandingMinor: selected.creditOutstandingMinor,
    reverseCharge: storedRevision?.reverseCharge ?? invoice.reverseCharge,
    status: storedRevision?.status ?? invoice.status,
    validationWarnings: storedRevision?.validationWarnings ?? invoice.validationWarnings,
    paymentStatus: storedRevision?.paymentStatus ?? invoice.paymentStatus,
    pricingSnapshot: selected.pricingSnapshot,
    revision: requestedRevision,
    issuedAt: selectedIssuedAt,
    revisedAt: requestedRevision > 1 ? selectedIssuedAt : null,
    isLatest: requestedRevision === invoice.revision,
    versions
  };
}
