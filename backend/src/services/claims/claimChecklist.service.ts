import { ClaimDocument } from "../../models/claimDocument.model.js";
import { ClaimPolicyRule } from "../../models/claimPolicyRule.model.js";
import type { ClaimDocumentCategory } from "../../models/claimDocument.model.js";
import type { ClaimCategory } from "../../models/claimTypes.js";

/**
 * What evidence a claim needs, and how much of it has arrived.
 *
 * The list changes with the claim category: a total loss cannot have photographs
 * of damaged goods, and a shortage needs a count rather than a condition report.
 * Asking for the wrong documents is the fastest way to make a claim take a month.
 */

/** Required for every claim, whatever went wrong. */
const alwaysRequired: ClaimDocumentCategory[] = ["VALUE_PROOF", "PACKING_LIST"];

const byCategory: Record<ClaimCategory, ClaimDocumentCategory[]> = {
  TOTAL_LOSS: ["NON_RECEIPT_DECLARATION"],
  PARTIAL_LOSS: ["GOODS_PHOTO", "OUTER_PACKAGING_PHOTO", "MISSING_ITEM_LIST"],
  SHORTAGE: ["GOODS_PHOTO", "MISSING_ITEM_LIST"],
  PHYSICAL_DAMAGE: ["GOODS_PHOTO", "OUTER_PACKAGING_PHOTO", "INNER_PACKAGING_PHOTO", "LABEL_PHOTO"],
  THEFT_OR_TAMPERING: ["TAMPERING_PHOTO", "LABEL_PHOTO", "MISSING_ITEM_LIST", "CONSIGNEE_STATEMENT"],
  DELAY_CAUSING_PHYSICAL_LOSS: ["GOODS_PHOTO"]
};

/**
 * Documents staff may ask for case by case.
 *
 * Not part of the standard list because requiring them of everyone would make a
 * routine claim feel like an investigation.
 */
export const conditionalDocumentValues: ClaimDocumentCategory[] = [
  "REPAIR_QUOTATION",
  "REPLACEMENT_QUOTATION",
  "SURVEY_REPORT",
  "INSPECTION_REPORT",
  "SALVAGE_VALUATION",
  "DISPOSAL_CERTIFICATE",
  "POLICE_REPORT",
  "CCTV_EVIDENCE",
  "CONSIGNEE_STATEMENT",
  "TEMPERATURE_LOG",
  "EXPIRY_INFORMATION",
  "CARRIER_EXCEPTION_REPORT",
  "CLAIMANT_AUTHORITY",
  "DELIVERY_EXCEPTION"
];

export function requiredDocumentsFor(category: ClaimCategory, policyOverride?: ClaimDocumentCategory[]) {
  // A policy rule can replace the list wholesale — a negotiated contract may
  // waive the packing list, or a route may demand a carrier exception report.
  if (policyOverride && policyOverride.length > 0) return [...new Set(policyOverride)];
  return [...new Set([...alwaysRequired, ...byCategory[category]])];
}

export type ChecklistItemState =
  | "MISSING"
  | "UPLOADED"
  | "ACCEPTED"
  | "REJECTED"
  | "WAIVED"
  | "SOURCED_FROM_PORTAL";

export interface ChecklistItem {
  category: ClaimDocumentCategory;
  required: boolean;
  state: ChecklistItemState;
  documentId: string | null;
  rejectionReason: string;
}

export interface ClaimChecklist {
  items: ChecklistItem[];
  /** True when every required document is present and none was rejected. */
  complete: boolean;
  missingCount: number;
  rejectedCount: number;
}

/**
 * Builds the checklist for a claim, reading the waivers, staff requests, and
 * policy override off the claim itself.
 *
 * Callers used to have to assemble those three by hand and every one of them
 * passed none, which quietly made waivers, conditional requests, and negotiated
 * document terms do nothing. Loading them here means a caller cannot forget.
 */
export async function buildClaimChecklistFor(
  claim: {
    _id: unknown;
    category: ClaimCategory;
    waivedDocuments?: Array<{ category: string }>;
    requestedDocuments?: Array<{ category: string }>;
    deadlines?: { policyRuleId?: unknown } | null;
  },
  options: { audience?: "CLIENT" | "STAFF" } = {}
): Promise<ClaimChecklist> {
  // Only read when the claim actually froze a rule onto itself at submission.
  const policyRequiredDocuments = claim.deadlines?.policyRuleId
    ? (
        await ClaimPolicyRule.findById(claim.deadlines.policyRuleId)
          .select("requiredDocuments")
          .lean()
          .exec()
      )?.requiredDocuments
    : undefined;

  return buildClaimChecklist({
    claimId: String(claim._id),
    category: claim.category,
    policyRequiredDocuments: policyRequiredDocuments as ClaimDocumentCategory[] | undefined,
    waivedCategories: (claim.waivedDocuments ?? []).map(
      (entry) => entry.category
    ) as ClaimDocumentCategory[],
    requestedCategories: (claim.requestedDocuments ?? []).map(
      (entry) => entry.category
    ) as ClaimDocumentCategory[],
    audience: options.audience ?? "STAFF"
  });
}

export async function buildClaimChecklist(input: {
  claimId: string;
  category: ClaimCategory;
  policyRequiredDocuments?: ClaimDocumentCategory[];
  waivedCategories?: ClaimDocumentCategory[];
  requestedCategories?: ClaimDocumentCategory[];
  audience?: "CLIENT" | "STAFF";
}): Promise<ClaimChecklist> {
  const required = requiredDocumentsFor(input.category, input.policyRequiredDocuments);
  const waived = new Set(input.waivedCategories ?? []);

  // A client must not be shown a checklist row for a document they cannot open.
  // Staff-uploaded payment proof is internal by default, and counting it here
  // produced a row with a status badge and no file behind it.
  const documents = await ClaimDocument.find({
    claimId: input.claimId,
    deletedAt: null,
    ...(input.audience === "CLIENT" ? { visibility: "PUBLIC" } : {})
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  // Most recent per category wins, so a replacement supersedes what it replaced
  // without the older row disappearing from history.
  const latest = new Map<string, (typeof documents)[number]>();
  for (const document of documents) {
    if (!latest.has(document.category)) latest.set(document.category, document);
  }

  const categories = [
    ...new Set([...required, ...(input.requestedCategories ?? []), ...latest.keys()])
  ] as ClaimDocumentCategory[];

  const items: ChecklistItem[] = categories.map((category) => {
    const document = latest.get(category);
    const isRequired = required.includes(category) || (input.requestedCategories ?? []).includes(category);

    let state: ChecklistItemState = "MISSING";
    if (waived.has(category)) state = "WAIVED";
    else if (document?.sourcedFromPortal) state = "SOURCED_FROM_PORTAL";
    else if (document?.reviewState === "ACCEPTED") state = "ACCEPTED";
    else if (document?.reviewState === "REJECTED") state = "REJECTED";
    else if (document) state = "UPLOADED";

    return {
      category,
      required: isRequired,
      state,
      documentId: document ? String(document._id) : null,
      rejectionReason: document?.rejectionReason ?? ""
    };
  });

  // A rejected document counts as missing: it is present but cannot be relied on,
  // and treating it as satisfied would let a claim reach review on evidence a
  // reviewer has already refused. A waived one does not — that is the whole
  // point of waiving it.
  const outstanding = items.filter(
    (item) =>
      item.required &&
      item.state !== "WAIVED" &&
      (item.state === "MISSING" || item.state === "REJECTED")
  );

  return {
    items,
    complete: outstanding.length === 0,
    missingCount: items.filter((item) => item.required && item.state === "MISSING").length,
    rejectedCount: items.filter((item) => item.state === "REJECTED").length
  };
}
