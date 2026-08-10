import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccount, type IBusinessAccount } from "../models/businessAccount.model.js";
import { BusinessCreditAccount, type IBusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditAgreement, type CreditAgreementSnapshot, type ICreditAgreement } from "../models/creditAgreement.model.js";
import { CreditAgreementCounter } from "../models/creditAgreementCounter.model.js";
import { getCurrentPaymentTerms } from "./creditAccount.service.js";
import { renderCreditAgreementPdf } from "./creditAgreementPdf.service.js";
import { removeCreditAgreementPdf, saveCreditAgreementPdf } from "./creditAgreementStorage.service.js";
import { notifyActiveAdmins, notifyBusinessFinancialMembers } from "./portalNotification.service.js";

export type CreditAgreementErrorCode =
  | "BUSINESS_NOT_FOUND"
  | "BUSINESS_NOT_ELIGIBLE"
  | "KYC_NOT_VERIFIED"
  | "CREDIT_NOT_APPROVED"
  | "OPEN_AGREEMENT_EXISTS"
  | "AGREEMENT_NOT_FOUND"
  | "AGREEMENT_CANNOT_BE_GENERATED"
  | "AGREEMENT_CANNOT_BE_SIGNED";

export class CreditAgreementServiceError extends Error {
  constructor(public readonly code: CreditAgreementErrorCode, message: string) {
    super(message);
    this.name = "CreditAgreementServiceError";
  }
}

export function buildCreditAgreementSnapshot(
  business: IBusinessAccount,
  credit: IBusinessCreditAccount
): CreditAgreementSnapshot {
  return {
    business: {
      accountId: business.accountId,
      companyName: business.company.companyName || business.accountId,
      gstin: business.company.gstin || "",
      registrationId: business.company.registrationId || "",
      registeredAddress: business.company.registeredAddress || "",
      city: business.company.city || "",
      stateOrProvince: business.company.stateOrProvince || "",
      postalCode: business.company.postalCode || "",
      addressCountry: business.company.addressCountry || business.company.registrationCountry || "",
      contactName: [business.contact.firstName, business.contact.lastName].filter(Boolean).join(" "),
      contactEmail: business.contact.email,
      contactJobTitle: business.contact.jobTitle || ""
    },
    credit: {
      currency: credit.currency,
      approvedCreditLimitMinor: credit.approvedCreditLimitMinor,
      paymentTermsDays: credit.paymentTermsDays,
      billingCycle: credit.billingCycle,
      validFrom: credit.validFrom ?? null,
      validUntil: credit.validUntil ?? null,
      gracePeriodDays: credit.gracePeriodDays,
      maxOverdueDays: credit.maxOverdueDays,
      creditWarningThresholdPercent: credit.creditWarningThresholdPercent,
      securityDepositRequiredMinor: credit.securityDepositRequiredMinor
    }
  };
}

function publicDocumentMetadata(document?: ICreditAgreement["generatedDocument"] | null) {
  if (!document) return null;
  return {
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    checksumSha256: document.checksumSha256,
    storedAt: document.storedAt
  };
}

export function serializeCreditAgreement(agreement: ICreditAgreement, options: { includeAuditDetails?: boolean } = {}) {
  const signer = agreement.signer ? {
    name: agreement.signer.name,
    email: agreement.signer.email,
    jobTitle: agreement.signer.jobTitle,
    ...(options.includeAuditDetails ? {
      userId: agreement.signer.userId ? String(agreement.signer.userId) : null,
      ipAddress: agreement.signer.ipAddress,
      userAgent: agreement.signer.userAgent
    } : {})
  } : null;
  return {
    id: String(agreement._id),
    agreementNumber: agreement.agreementNumber,
    businessAccountId: String(agreement.businessAccountId),
    creditAccountId: String(agreement.creditAccountId),
    version: agreement.version,
    status: agreement.status,
    termsVersion: agreement.termsVersion,
    snapshot: agreement.snapshot,
    generatedDocument: publicDocumentMetadata(agreement.generatedDocument),
    signedDocument: publicDocumentMetadata(agreement.signedDocument),
    sentAt: agreement.sentAt ?? null,
    viewedAt: agreement.viewedAt ?? null,
    signedAt: agreement.signedAt ?? null,
    declinedAt: agreement.declinedAt ?? null,
    expiredAt: agreement.expiredAt ?? null,
    supersededAt: agreement.supersededAt ?? null,
    signer,
    ...(options.includeAuditDetails ? {
      createdBy: String(agreement.createdBy),
      updatedBy: agreement.updatedBy ? String(agreement.updatedBy) : null
    } : {}),
    createdAt: agreement.createdAt,
    updatedAt: agreement.updatedAt
  };
}

function agreementNumber(accountId: string, version: number) {
  const normalizedAccountId = accountId.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return `CA-${normalizedAccountId}-V${String(version).padStart(3, "0")}`;
}

export async function createCreditAgreementDraft(input: {
  businessAccountId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}) {
  const session = await mongoose.startSession();
  try {
    let createdAgreement: ICreditAgreement | null = null;
    await session.withTransaction(async () => {
      const business = await BusinessAccount.findById(input.businessAccountId).session(session).exec();
      if (!business) throw new CreditAgreementServiceError("BUSINESS_NOT_FOUND", "Business account was not found.");
      if (!["approved", "active"].includes(business.status)) {
        throw new CreditAgreementServiceError("BUSINESS_NOT_ELIGIBLE", "Approve the business account before creating a credit agreement.");
      }
      if (business.kycReview.overallStatus !== "verified") {
        throw new CreditAgreementServiceError("KYC_NOT_VERIFIED", "KYC must be verified before creating a credit agreement.");
      }

      const credit = await BusinessCreditAccount.findOne({ businessAccountId: business._id }).session(session).exec();
      if (!credit || !["APPROVED", "ACTIVE"].includes(credit.status) || credit.approvedCreditLimitMinor <= 0) {
        throw new CreditAgreementServiceError("CREDIT_NOT_APPROVED", "Approve a positive credit limit before creating an agreement.");
      }

      const openAgreement = await CreditAgreement.exists({
        businessAccountId: business._id,
        status: { $in: ["DRAFT", "GENERATED", "SENT", "VIEWED"] }
      }).session(session);
      if (openAgreement) {
        throw new CreditAgreementServiceError("OPEN_AGREEMENT_EXISTS", "An open credit agreement already exists for this business account.");
      }

      const [counter, terms] = await Promise.all([
        CreditAgreementCounter.findOneAndUpdate(
          { businessAccountId: business._id },
          { $inc: { version: 1 } },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, session }
        ).exec(),
        getCurrentPaymentTerms()
      ]);

      const documents = await CreditAgreement.create([{
        agreementNumber: agreementNumber(business.accountId, counter.version),
        businessAccountId: business._id,
        creditAccountId: credit._id,
        version: counter.version,
        status: "DRAFT",
        termsVersion: terms.version,
        snapshot: buildCreditAgreementSnapshot(business, credit),
        createdBy: input.createdBy
      }], { session });
      createdAgreement = documents[0] ?? null;
      if (!createdAgreement) throw new Error("Credit agreement draft could not be created.");

      await AuditLog.create([{
        action: "CREDIT_AGREEMENT_DRAFT_CREATED",
        entityType: "CREDIT_AGREEMENT",
        entityId: createdAgreement._id,
        performedBy: input.createdBy,
        performedAt: new Date(),
        metadata: {
          businessAccountId: business._id,
          creditAccountId: credit._id,
          agreementNumber: createdAgreement.agreementNumber,
          version: createdAgreement.version
        }
      }], { session });
    });

    if (!createdAgreement) throw new Error("Credit agreement draft could not be created.");
    return createdAgreement as ICreditAgreement;
  } catch (error) {
    if (error instanceof CreditAgreementServiceError) throw error;
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      throw new CreditAgreementServiceError("OPEN_AGREEMENT_EXISTS", "An open credit agreement already exists for this business account.");
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function generateCreditAgreement(input: {
  agreementId: mongoose.Types.ObjectId;
  generatedBy: mongoose.Types.ObjectId;
}) {
  const agreement = await CreditAgreement.findById(input.agreementId).exec();
  if (!agreement) {
    throw new CreditAgreementServiceError("AGREEMENT_NOT_FOUND", "Credit agreement was not found.");
  }
  if (agreement.status === "GENERATED" && agreement.generatedDocument) {
    return agreement;
  }
  if (agreement.status !== "DRAFT") {
    throw new CreditAgreementServiceError(
      "AGREEMENT_CANNOT_BE_GENERATED",
      "Only a draft credit agreement can be generated."
    );
  }

  const generatedAt = new Date();
  const buffer = await renderCreditAgreementPdf(agreement, generatedAt);
  const storedDocument = await saveCreditAgreementPdf({
    agreementId: String(agreement._id),
    agreementNumber: agreement.agreementNumber,
    buffer,
    storedAt: generatedAt
  });

  const session = await mongoose.startSession();
  let generatedAgreement: ICreditAgreement | null = null;
  let transactionCommitted = false;
  try {
    await session.withTransaction(async () => {
      generatedAgreement = await CreditAgreement.findOneAndUpdate(
        { _id: agreement._id, status: "DRAFT", generatedDocument: null },
        {
          $set: {
            status: "GENERATED",
            generatedDocument: storedDocument,
            updatedBy: input.generatedBy
          }
        },
        { returnDocument: "after", session }
      ).exec();

      if (!generatedAgreement) return;
      await BusinessAccount.updateOne(
        { _id: agreement.businessAccountId, agreementStatus: { $ne: "signed" } },
        { $set: { agreementStatus: "generated", updatedBy: input.generatedBy } },
        { session }
      ).exec();
      await AuditLog.create([{
        action: "CREDIT_AGREEMENT_GENERATED",
        entityType: "CREDIT_AGREEMENT",
        entityId: agreement._id,
        performedBy: input.generatedBy,
        performedAt: generatedAt,
        metadata: {
          businessAccountId: agreement.businessAccountId,
          creditAccountId: agreement.creditAccountId,
          agreementNumber: agreement.agreementNumber,
          version: agreement.version,
          checksumSha256: storedDocument.checksumSha256,
          documentSize: storedDocument.size
        }
      }], { session });
    });
    transactionCommitted = true;

    if (generatedAgreement) {
      const agreementDocument = generatedAgreement as ICreditAgreement;
      await notifyBusinessFinancialMembers(agreementDocument.businessAccountId, {
        type: "CREDIT_AGREEMENT_READY",
        title: "Credit agreement ready to sign",
        message: `${agreementDocument.agreementNumber} is ready. Review and sign it to activate your credit facility.`,
        href: `/client/credit/agreements/${String(agreementDocument._id)}`,
        idempotencyKey: `CREDIT_AGREEMENT_READY:${String(agreementDocument._id)}`,
        metadata: { agreementId: agreementDocument._id, agreementNumber: agreementDocument.agreementNumber }
      });
      return agreementDocument;
    }

    // A concurrent request may have completed generation first. Keep its document and discard this duplicate.
    await removeCreditAgreementPdf(storedDocument.storageKey);
    const current = await CreditAgreement.findById(agreement._id).exec();
    if (current?.status === "GENERATED" && current.generatedDocument) return current;
    throw new CreditAgreementServiceError(
      "AGREEMENT_CANNOT_BE_GENERATED",
      "The credit agreement changed while it was being generated. Refresh and try again."
    );
  } catch (error) {
    if (!transactionCommitted) await removeCreditAgreementPdf(storedDocument.storageKey);
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function signCreditAgreement(input: {
  agreementId: mongoose.Types.ObjectId;
  signedBy: mongoose.Types.ObjectId;
  signer: { name: string; email: string; jobTitle: string; ipAddress: string; userAgent: string };
}) {
  const agreement = await CreditAgreement.findById(input.agreementId).exec();
  if (!agreement) throw new CreditAgreementServiceError("AGREEMENT_NOT_FOUND", "Credit agreement was not found.");
  if (agreement.status === "SIGNED" && agreement.signedDocument) return agreement;
  if (agreement.status !== "VIEWED") {
    throw new CreditAgreementServiceError("AGREEMENT_CANNOT_BE_SIGNED", "Open and review the credit agreement before signing it.");
  }

  const signedAt = new Date();
  const pdf = await renderCreditAgreementPdf(agreement, agreement.generatedDocument?.storedAt ?? signedAt, {
    name: input.signer.name,
    email: input.signer.email,
    jobTitle: input.signer.jobTitle,
    signedAt
  });
  const signedDocument = await saveCreditAgreementPdf({
    agreementId: String(agreement._id),
    agreementNumber: agreement.agreementNumber,
    buffer: pdf,
    storedAt: signedAt,
    documentType: "signed"
  });

  const session = await mongoose.startSession();
  let signedAgreement: ICreditAgreement | null = null;
  let transactionCommitted = false;
  try {
    await session.withTransaction(async () => {
      signedAgreement = await CreditAgreement.findOneAndUpdate(
        { _id: agreement._id, status: "VIEWED", signedDocument: null },
        {
          $set: {
            status: "SIGNED",
            signedDocument,
            signedAt,
            signer: { userId: input.signedBy, ...input.signer },
            updatedBy: input.signedBy
          }
        },
        { returnDocument: "after", session }
      ).exec();
      if (!signedAgreement) return;

      await BusinessAccount.updateOne(
        { _id: agreement.businessAccountId },
        { $set: { agreementStatus: "signed", updatedBy: input.signedBy } },
        { session }
      ).exec();
      await AuditLog.create([{
        action: "CREDIT_AGREEMENT_SIGNED",
        entityType: "CREDIT_AGREEMENT",
        entityId: agreement._id,
        performedBy: input.signedBy,
        performedAt: signedAt,
        metadata: {
          businessAccountId: agreement.businessAccountId,
          agreementNumber: agreement.agreementNumber,
          termsVersion: agreement.termsVersion,
          checksumSha256: signedDocument.checksumSha256,
          signerEmail: input.signer.email
        }
      }], { session });
    });
    transactionCommitted = true;

    if (signedAgreement) {
      const agreementDocument = signedAgreement as ICreditAgreement;
      await notifyActiveAdmins({
        type: "CREDIT_AGREEMENT_SIGNED",
        title: "Credit agreement signed",
        message: `${agreementDocument.agreementNumber} was signed by ${input.signer.name}. The credit facility can now be activated.`,
        href: `/dashboard/credit-accounts#credit-account-${String(agreementDocument.businessAccountId)}`,
        idempotencyKey: `CREDIT_AGREEMENT_SIGNED:${String(agreementDocument._id)}`,
        businessAccountId: agreementDocument.businessAccountId,
        metadata: { agreementId: agreementDocument._id, agreementNumber: agreementDocument.agreementNumber }
      });
      return agreementDocument;
    }
    await removeCreditAgreementPdf(signedDocument.storageKey);
    const current = await CreditAgreement.findById(agreement._id).exec();
    if (current?.status === "SIGNED" && current.signedDocument) return current;
    throw new CreditAgreementServiceError("AGREEMENT_CANNOT_BE_SIGNED", "The agreement changed while it was being signed. Refresh and try again.");
  } catch (error) {
    if (!transactionCommitted) await removeCreditAgreementPdf(signedDocument.storageKey);
    throw error;
  } finally {
    await session.endSession();
  }
}
