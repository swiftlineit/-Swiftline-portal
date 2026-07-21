import crypto from "crypto";
import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { validateShipmentDraftFields } from "./shipmentValidation.service.js";

export class ManualShipmentDraftError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "ManualShipmentDraftError";
  }
}

async function resolveBusinessAccount(value: string) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const account = await BusinessAccount.findById(value).exec();
    if (account) return account;
  }

  return BusinessAccount.findOne({ accountId: value }).exec();
}

async function resolveBranch(value: string) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const branch = await Branch.findById(value).exec();
    if (branch) return branch;
  }

  return Branch.findOne({ code: value.toUpperCase() }).exec();
}

export async function createBlankShipmentDraft(input: {
  businessAccountId: string;
  branchId: string;
  createdBy: mongoose.Types.ObjectId;
}) {
  const [businessAccount, branch] = await Promise.all([
    resolveBusinessAccount(input.businessAccountId),
    resolveBranch(input.branchId)
  ]);

  if (!businessAccount) throw new ManualShipmentDraftError("Business account not found.", 404);
  if (!branch) throw new ManualShipmentDraftError("Sender branch not found.", 404);
  if (!["approved", "active"].includes(businessAccount.status)) {
    throw new ManualShipmentDraftError("The business account must be approved before creating a shipment draft.", 409);
  }
  if (!businessAccount.assignedBranch) {
    throw new ManualShipmentDraftError("Assign a branch to this business account before creating a shipment draft.", 409);
  }
  if (String(businessAccount.assignedBranch) !== String(branch._id)) {
    throw new ManualShipmentDraftError("The selected branch is not assigned to this business account.", 403);
  }
  if (branch.status !== "ACTIVE") {
    throw new ManualShipmentDraftError("The assigned branch is not active. Contact Swiftline support.", 409);
  }

  const sourceToken = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const sourceReference = sourceToken.slice(0, 16);
  const session = await mongoose.startSession();
  let shipmentDraft: InstanceType<typeof ShipmentDraft> | null = null;

  try {
    await session.withTransaction(async () => {
      // Keep an internal source record so label, invoice and billing flows retain stable references.
      const invoiceUpload = new InvoiceUpload({
        businessAccountId: businessAccount._id,
        branchId: branch._id,
        templateVersion: "MANUAL-1.0",
        invoiceNumber: `MANUAL-INV-${sourceReference}`,
        shipmentReference: `MANUAL-SHIP-${sourceReference}`,
        originalFilename: "Manual shipment entry",
        storagePath: `manual://shipment-draft/${sourceToken}`,
        fileChecksum: crypto.createHash("sha256").update(sourceToken).digest("hex"),
        extractedData: { creationSource: "MANUAL" },
        status: "PARSED",
        processingErrors: [],
        uploadedBy: input.createdBy,
        uploadedAt: new Date()
      });
      await invoiceUpload.save({ session });

      const draft = new ShipmentDraft({
        invoiceUploadId: invoiceUpload._id,
        businessAccountId: businessAccount._id,
        branchId: branch._id,
        sender: {
          branchId: branch._id,
          name: branch.name,
          code: branch.code,
          address: branch.address,
          contact: branch.contact
        },
        consigneeEnteredAddress: {
          companyName: "",
          contactName: "",
          email: "",
          mobileCountryCode: "",
          mobileNumber: "",
          countryCode: "",
          countryName: "",
          postcode: "",
          addressLine1: "",
          addressLine2: "",
          townOrCity: "",
          county: "",
          deliveryInstructions: ""
        },
        consigneeSelectedAddress: null,
        consigneeValidatedAddress: null,
        googlePlaceId: "",
        addressValidationStatus: "NOT_VALIDATED",
        addressValidationResult: {},
        parcelCount: 1,
        parcelList: [{
          sequence: 1,
          weightKg: 0,
          shipmentContentType: "PARCEL",
          contentsDescription: "",
          shipmentReference1: "",
          shipmentReference2: ""
        }],
        serviceType: "COURIER",
        serviceCode: "",
        validationIssues: [],
        status: "NEEDS_REVIEW",
        createdBy: input.createdBy
      });
      draft.validationIssues = validateShipmentDraftFields(draft);
      await draft.save({ session });

      await new AuditLog({
        action: "SHIPMENT_DRAFT_CREATED",
        entityType: "SHIPMENT_DRAFT",
        entityId: draft._id,
        performedBy: input.createdBy,
        performedAt: new Date(),
        metadata: {
          creationSource: "MANUAL",
          businessAccountId: businessAccount._id,
          branchId: branch._id,
          invoiceUploadId: invoiceUpload._id
        }
      }).save({ session });

      shipmentDraft = draft;
    });
  } finally {
    await session.endSession();
  }

  if (!shipmentDraft) {
    throw new ManualShipmentDraftError("The blank shipment draft could not be created. Please try again.", 500);
  }

  return shipmentDraft;
}
