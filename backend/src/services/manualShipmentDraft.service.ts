import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { getOrCreateIndividualSentinel } from "./individualCustomer.service.js";
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

/**
 * Refuses a draft opened in a branch the caller does not hold.
 *
 * Checked against the resolved branch rather than the requested value, because
 * `branchId` may arrive as either an id or a branch code — a guard reading the
 * raw request body would reject every code-form call as malformed.
 * `null` means unrestricted, as it does throughout the branch middleware. It is
 * a required argument rather than an optional one so a new caller cannot open
 * an unscoped path by leaving it off.
 */
function assertBranchAllowed(allowedBranchIds: string[] | null, branchId: mongoose.Types.ObjectId) {
  if (allowedBranchIds === null) return;
  if (allowedBranchIds.includes(String(branchId))) return;

  throw new ManualShipmentDraftError("You do not have access to this branch.", 403);
}

/**
 * Identity of a walk-in customer. Only the name is taken at the counter — every
 * other field is filled in on the draft form and enforced before booking.
 */
export type IndividualCustomerInput = {
  contactName: string;
  mobileCountryCode?: string;
  mobileNumber?: string;
  email?: string;
  aadhaarNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  townOrCity?: string;
  county?: string;
  postcode?: string;
  pickupInstructions?: string;
};

/**
 * Opens a blank draft for a walk-in customer.
 *
 * Structurally the same as `createBlankShipmentDraft`, with two differences: it
 * books against the system sentinel rather than a customer account, and the
 * person paying is written into `consignorAddress`, which is
 * where the booking snapshot and the invoice bill-to already read the sender
 * from. The sentinel serves every branch, so the assigned-branch checks that
 * ordinary accounts go through do not apply.
 */
export async function createIndividualShipmentDraft(input: {
  branchId: string;
  customer: IndividualCustomerInput;
  createdBy: mongoose.Types.ObjectId;
  allowedBranchIds: string[] | null;
}) {
  const branch = await resolveBranch(input.branchId);
  if (!branch) throw new ManualShipmentDraftError("Sender branch not found.", 404);
  assertBranchAllowed(input.allowedBranchIds, branch._id);
  if (branch.status !== "ACTIVE") {
    throw new ManualShipmentDraftError("The selected branch is not active.", 409);
  }
  if (!input.customer.contactName.trim()) {
    throw new ManualShipmentDraftError("Enter the customer's name.", 400);
  }

  const sentinel = await getOrCreateIndividualSentinel(input.createdBy);

  const session = await mongoose.startSession();
  let shipmentDraft: InstanceType<typeof ShipmentDraft> | null = null;

  try {
    await session.withTransaction(async () => {
      const draft = new ShipmentDraft({
        creationSource: "INDIVIDUAL",
        businessAccountId: sentinel._id,
        customerType: "INDIVIDUAL",
        branchId: branch._id,
        sender: {
          branchId: branch._id,
          name: branch.name,
          code: branch.code,
          address: branch.address,
          contact: branch.contact
        },
        consignorAddress: {
          companyName: "",
          contactName: input.customer.contactName.trim(),
          email: (input.customer.email ?? "").trim(),
          mobileCountryCode: (input.customer.mobileCountryCode ?? "+91").trim(),
          mobileNumber: (input.customer.mobileNumber ?? "").trim(),
          aadhaarNumber: (input.customer.aadhaarNumber ?? "").replace(/\D/g, ""),
          addressLine1: (input.customer.addressLine1 ?? "").trim(),
          addressLine2: (input.customer.addressLine2 ?? "").trim(),
          townOrCity: (input.customer.townOrCity ?? "").trim(),
          county: (input.customer.county ?? "").trim(),
          postcode: (input.customer.postcode ?? "").trim(),
          pickupInstructions: (input.customer.pickupInstructions ?? "").trim()
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
          creationSource: "INDIVIDUAL",
          customerType: "INDIVIDUAL",
          businessAccountId: sentinel._id,
          branchId: branch._id
        }
      }).save({ session });

      shipmentDraft = draft;
    });
  } finally {
    await session.endSession();
  }

  // Read through a widened alias: the assignment happens inside the transaction
  // callback, which control-flow analysis cannot see, so narrowing the original
  // binding here would collapse the return type to `never`.
  const created = shipmentDraft as InstanceType<typeof ShipmentDraft> | null;
  if (!created) {
    throw new ManualShipmentDraftError("The individual shipment draft could not be created. Please try again.", 500);
  }

  return created;
}

export async function createBlankShipmentDraft(input: {
  businessAccountId: string;
  branchId: string;
  createdBy: mongoose.Types.ObjectId;
  allowedBranchIds: string[] | null;
}) {
  const [businessAccount, branch] = await Promise.all([
    resolveBusinessAccount(input.businessAccountId),
    resolveBranch(input.branchId)
  ]);

  if (!businessAccount) throw new ManualShipmentDraftError("Business account not found.", 404);
  if (!branch) throw new ManualShipmentDraftError("Sender branch not found.", 404);
  // Before the account checks below, so a member cannot read another branch's
  // account state out of the error it gets back.
  assertBranchAllowed(input.allowedBranchIds, branch._id);
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

  const session = await mongoose.startSession();
  let shipmentDraft: InstanceType<typeof ShipmentDraft> | null = null;

  try {
    await session.withTransaction(async () => {
      const draft = new ShipmentDraft({
        creationSource: "MANUAL",
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
          branchId: branch._id
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
