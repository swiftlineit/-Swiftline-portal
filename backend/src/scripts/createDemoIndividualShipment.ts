import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Branch } from "../models/branch.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent, type ShipmentEventStatus } from "../models/shipmentEvent.model.js";
import { User } from "../models/user.model.js";
import { getOrCreateIndividualSentinel, recordCounterCollection } from "../services/individualCustomer.service.js";
import { createIndividualShipmentDraft } from "../services/manualShipmentDraft.service.js";
import { recordCounterShipmentCharge } from "../services/shipmentBookingBilling.service.js";
import { buildShipmentBookingSnapshot } from "../services/shipmentBookingSnapshot.service.js";
import { calculateShipmentPricingEstimate } from "../services/shipmentPricing.service.js";
import { ensureShipmentInvoiceForDraft } from "../services/shipmentInvoice.service.js";
import { storeGeneratedLabel } from "../services/dpdShipment.service.js";
import { SWIFTLINE_SERVICE_CODE } from "../services/shipmentPayload.service.js";
import {
  renderSwiftlineLabelPdf,
  type ShipmentLabelData
} from "../services/shipmentLabelPdf.service.js";

/**
 * Seeds one booked walk-in shipment: the individual-customer equivalent of
 * `createDemoShipment.ts`.
 *
 * The carrier call is mocked, as it is there, but everything that makes this a
 * counter sale runs for real — the sentinel account, the ADMIN_DIRECT charge with
 * no credit reservation, the booking snapshot that bills the person rather than
 * the sentinel, the paid invoice, and the counter payment record. That is the
 * point: it exercises the paths that differ from a business booking.
 */
const customerName = process.env.DEMO_INDIVIDUAL_NAME || "Rohit Sharma";
const customerMobile = process.env.DEMO_INDIVIDUAL_MOBILE || "9876500099";
const paymentMethod = (process.env.DEMO_INDIVIDUAL_PAYMENT_METHOD || "UPI") as "CASH" | "UPI" | "BANK_TRANSFER" | "CARD" | "CHEQUE";
const eventStatuses: ShipmentEventStatus[] = ["SHIPMENT_BOOKED", "PARCEL_COLLECTED"];

function mongoUri() {
  const separator = env.MONGODB_URI.includes("?") ? "&" : "?";
  return env.MONGODB_URI.includes("retryWrites=")
    ? env.MONGODB_URI
    : `${env.MONGODB_URI}${separator}retryWrites=false`;
}

const destinationAddress = {
  companyName: "",
  contactName: "Avery Individual",
  email: "individual.consignee@example.com",
  mobileCountryCode: "+44",
  mobileNumber: "7700900789",
  countryCode: "GB",
  countryName: "United Kingdom",
  postcode: "E16 1XL",
  addressLine1: "Flat 4, Royal Victoria Dock",
  addressLine2: "",
  townOrCity: "London",
  county: "Greater London",
  deliveryInstructions: "Individual demo shipment. Call before delivery."
};

async function main() {
  await mongoose.connect(mongoUri());

  const actor = await User.findOne({ role: "admin" }).lean().exec();
  if (!actor) throw new Error("No admin user found to attribute the demo shipment to.");
  const actorId = actor._id as mongoose.Types.ObjectId;

  const branch = await Branch.findOne({ status: "ACTIVE" }).lean().exec();
  if (!branch) throw new Error("No active branch found. Create one before seeding an individual shipment.");

  // 1. The counter opens a draft for the walk-in. This resolves (or creates) the
  //    sentinel and stores the customer on the draft.
  const draft = await createIndividualShipmentDraft({
    branchId: String(branch._id),
    // A seeding script runs outside any branch assignment.
    allowedBranchIds: null,
    customer: {
      contactName: customerName,
      mobileCountryCode: "+91",
      mobileNumber: customerMobile,
      email: "rohit.demo@example.com",
      // Valid Verhoeff check digit, so KYC validation accepts it.
      aadhaarNumber: "234567890124",
      addressLine1: "12 Connaught Place",
      townOrCity: "New Delhi",
      county: "Delhi",
      postcode: "110001"
    },
    createdBy: actorId
  });

  // 2. Complete the draft the way the review screen would.
  draft.consigneeEnteredAddress = destinationAddress as never;
  draft.consigneeValidatedAddress = destinationAddress as never;
  draft.addressValidationStatus = "VALIDATED";
  draft.parcelList = [{
    sequence: 1,
    weightKg: 6,
    lengthCm: 30,
    widthCm: 25,
    heightCm: 20,
    shipmentContentType: "PARCEL",
    contentsDescription: "Personal effects",
    shipmentReference1: "IND-DEMO-01",
    shipmentReference2: ""
  }] as never;
  draft.parcelCount = 1;
  draft.serviceType = "COURIER";
  draft.serviceCode = SWIFTLINE_SERVICE_CODE;
  draft.status = "READY_FOR_DPD";
  draft.validationIssues = [];
  await draft.save();

  const pricing = await calculateShipmentPricingEstimate({
    businessAccountId: draft.businessAccountId,
    countryCode: destinationAddress.countryCode,
    serviceType: draft.serviceType,
    parcels: draft.parcelList,
    csbType: draft.csbType
  });
  if (pricing.missingRate) {
    throw new Error(`No rate card covers ${destinationAddress.countryCode} / ${draft.serviceType}. Add one before seeding.`);
  }

  // 3. Paid at the counter: a completed charge with no reservation, so nothing
  //    touches a credit account.
  await recordCounterShipmentCharge({ draft, pricing });

  const swiftlineTrackingNumber = `SLCIND${String(draft._id).slice(-6).toUpperCase()}`;
  const sentinel = await getOrCreateIndividualSentinel(actorId);
  const branchDocument = await Branch.findById(branch._id).exec();
  if (!branchDocument) throw new Error("Branch disappeared while seeding.");

  const dpdShipment = await DpdShipment.findOneAndUpdate(
    { shipmentDraftId: draft._id },
    {
      $set: {
        idempotencyKey: `demo-individual-shipment:${String(draft._id)}`,
        dpdShipmentId: `TEST-IND-${String(draft._id).slice(-8).toUpperCase()}`,
        dpdTransactionId: `TEST-TXN-${String(draft._id).slice(-8).toUpperCase()}`,
        parcelNumbers: [`${swiftlineTrackingNumber}-01`],
        serviceCode: draft.serviceCode,
        requestSnapshot: { seededIndividualShipment: true, shipmentDraftId: draft._id },
        responseSnapshot: { seededIndividualShipment: true, status: "LABEL_RECEIVED", labelCount: 1 },
        // What marks this as a counter sale everywhere downstream.
        paymentSource: "ADMIN_DIRECT",
        status: "LABEL_RECEIVED"
      }
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  ).exec();
  if (!dpdShipment) throw new Error("The demo shipment record could not be created.");

  // 4. The snapshot is what the invoice bills and what the manifests read. Built
  //    through the real service so the walk-in is billed as themselves.
  const totalMinor = Math.round(pricing.totalAmount * 100);
  const bookingSnapshot = buildShipmentBookingSnapshot({
    draft,
    account: sentinel,
    branch: branchDocument,
    pricing,
    serviceCode: draft.serviceCode,
    bookedAt: new Date(),
    swiftlineTrackingNumber,
    carrierShipmentId: dpdShipment.dpdShipmentId ?? "",
    carrierTransactionId: dpdShipment.dpdTransactionId ?? "",
    carrierParcelNumbers: [],
    // Settled in full at the counter, which is what makes the invoice PAID.
    advanceAmountMinor: totalMinor,
    creditAmountMinor: 0
  });
  dpdShipment.bookingSnapshot = bookingSnapshot as never;
  dpdShipment.currentShipmentSnapshot = bookingSnapshot as never;
  await dpdShipment.save();

  // A real booking transitions the draft to BOOKED. `resolveDraftBookingState`
  // would infer it from the carrier status anyway, but leaving the draft on its
  // EDITABLE default makes the seeded record differ from a genuinely booked one.
  draft.bookingState = "BOOKED";
  await draft.save();

  // 5. Real labels, so the parcel can be scanned into an operations manifest.
  const labelData: ShipmentLabelData = {
    parcelNumber: `${swiftlineTrackingNumber}-01`,
    parcelIndex: 0,
    parcelCount: 1,
    weightKg: 6,
    generatedAt: new Date(),
    origin: {
      stationCode: swiftlineTrackingNumber.slice(3, 6),
      city: "New Delhi"
    },
    destination: {
      city: destinationAddress.townOrCity,
      countryCode: destinationAddress.countryCode,
      countryName: destinationAddress.countryName
    },
    consignee: {
      name: destinationAddress.contactName,
      contactName: destinationAddress.contactName,
      addressLines: [destinationAddress.addressLine1, destinationAddress.townOrCity],
      postcode: destinationAddress.postcode,
      countryCode: destinationAddress.countryCode,
      countryName: destinationAddress.countryName,
      email: destinationAddress.email
    }
  };

  await storeGeneratedLabel({
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    parcelNumber: labelData.parcelNumber,
    buffer: await renderSwiftlineLabelPdf(labelData)
  });

  // 6. The money the branch actually took, for the counter sales report.
  await recordCounterCollection({
    shipmentDraftId: draft._id as mongoose.Types.ObjectId,
    branchId: branch._id as mongoose.Types.ObjectId,
    amountMinor: totalMinor,
    payment: { method: paymentMethod, reference: "DEMO-RCPT-001" },
    recordedBy: actorId
  });

  const now = new Date();
  await Promise.all(eventStatuses.map((status, index) => ShipmentEvent.findOneAndUpdate(
    { shipmentDraftId: draft._id, status },
    {
      $set: {
        dpdShipmentId: dpdShipment._id,
        note: "Seeded individual shipment",
        customerVisible: true,
        createdBy: actorId,
        eventAt: new Date(now.getTime() + index * 60_000)
      }
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  ).exec()));

  const invoice = await ensureShipmentInvoiceForDraft({
    shipmentDraftId: draft._id as mongoose.Types.ObjectId,
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    userId: actorId
  });

  console.log("Individual demo shipment seeded.");
  console.log("  customer          :", customerName, `(+91 ${customerMobile})`);
  console.log("  branch            :", `${branchDocument.code} - ${branchDocument.name}`);
  console.log("  draft id          :", String(draft._id));
  console.log("  shipment id       :", dpdShipment.dpdShipmentId);
  console.log("  tracking          :", swiftlineTrackingNumber);
  console.log("  scan barcode      :", labelData.parcelNumber);
  console.log("  charge total      :", `INR ${(totalMinor / 100).toFixed(2)}`);
  console.log("  invoice           :", invoice.invoiceNumber, `(${invoice.status}, payment ${invoice.paymentStatus})`);
  console.log("  counter payment   :", `${paymentMethod} collected`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});
