import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/** Typed client for the claims API, client and staff audiences. */

export type ClaimAudience = "client" | "staff";

export type ClaimCategory =
  | "TOTAL_LOSS"
  | "PARTIAL_LOSS"
  | "SHORTAGE"
  | "PHYSICAL_DAMAGE"
  | "THEFT_OR_TAMPERING"
  | "DELAY_CAUSING_PHYSICAL_LOSS";

export type ClaimStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "DOCUMENTS_PENDING"
  | "UNDER_REVIEW"
  | "NEEDS_INFORMATION"
  | "SUBMITTED_TO_CARRIER"
  | "CARRIER_REVIEWING"
  | "PENDING_APPROVAL"
  | "DECIDED"
  | "PAYMENT_PROCESSING"
  | "SETTLED"
  | "CLOSED"
  | "WITHDRAWN";

export type ClaimDecisionOutcome = "FULLY_APPROVED" | "PARTIALLY_APPROVED" | "REJECTED";

export type ClaimDocumentCategory =
  | "VALUE_PROOF" | "PACKING_LIST" | "GOODS_PHOTO" | "OUTER_PACKAGING_PHOTO"
  | "INNER_PACKAGING_PHOTO" | "LABEL_PHOTO" | "TAMPERING_PHOTO" | "MISSING_ITEM_LIST"
  | "NON_RECEIPT_DECLARATION" | "CONSIGNEE_STATEMENT" | "DELIVERY_EXCEPTION"
  | "REPAIR_QUOTATION" | "REPLACEMENT_QUOTATION" | "SURVEY_REPORT" | "INSPECTION_REPORT"
  | "SALVAGE_VALUATION" | "DISPOSAL_CERTIFICATE" | "POLICE_REPORT" | "CCTV_EVIDENCE"
  | "TEMPERATURE_LOG" | "EXPIRY_INFORMATION" | "CARRIER_EXCEPTION_REPORT"
  | "CLAIMANT_AUTHORITY" | "PAYMENT_PROOF" | "BENEFICIARY_PROOF" | "OTHER";

/**
 * Category labels and the wording each one shows the client.
 *
 * The help text matters: picking the wrong category means being asked for the
 * wrong evidence, which is the main way a straightforward claim turns into a
 * month of correspondence.
 */
export const claimCategories: Array<{
  value: ClaimCategory;
  label: string;
  help: string;
}> = [
  {
    value: "TOTAL_LOSS",
    label: "Total loss",
    help: "The whole shipment never arrived and is not expected to."
  },
  {
    value: "PARTIAL_LOSS",
    label: "Partial loss",
    help: "Some parcels arrived, others did not."
  },
  {
    value: "SHORTAGE",
    label: "Shortage",
    help: "The parcels arrived but items are missing from inside them."
  },
  {
    value: "PHYSICAL_DAMAGE",
    label: "Physical damage",
    help: "The goods arrived broken, crushed, or otherwise damaged."
  },
  {
    value: "THEFT_OR_TAMPERING",
    label: "Theft or tampering",
    help: "The packaging or seals were opened or interfered with in transit."
  },
  {
    value: "DELAY_CAUSING_PHYSICAL_LOSS",
    label: "Delay causing loss",
    help: "A delay spoiled or ruined the goods. For a delay alone, use the Help Desk."
  }
];

export const claimDocumentLabels: Record<ClaimDocumentCategory, string> = {
  VALUE_PROOF: "Proof of value (invoice)",
  PACKING_LIST: "Packing list",
  GOODS_PHOTO: "Photos of the goods",
  OUTER_PACKAGING_PHOTO: "Photos of the outer packaging",
  INNER_PACKAGING_PHOTO: "Photos of the inner packaging",
  LABEL_PHOTO: "Photo of the shipping label",
  TAMPERING_PHOTO: "Photos of the tampering or seals",
  MISSING_ITEM_LIST: "List of missing items",
  NON_RECEIPT_DECLARATION: "Declaration of non-receipt",
  CONSIGNEE_STATEMENT: "Statement from the receiver",
  DELIVERY_EXCEPTION: "Delivery exception record",
  REPAIR_QUOTATION: "Repair quotation",
  REPLACEMENT_QUOTATION: "Replacement quotation",
  SURVEY_REPORT: "Survey report",
  INSPECTION_REPORT: "Inspection report",
  SALVAGE_VALUATION: "Salvage valuation",
  DISPOSAL_CERTIFICATE: "Disposal certificate",
  POLICE_REPORT: "Police complaint or FIR",
  CCTV_EVIDENCE: "CCTV evidence",
  TEMPERATURE_LOG: "Temperature log",
  EXPIRY_INFORMATION: "Expiry information",
  CARRIER_EXCEPTION_REPORT: "Carrier exception report",
  CLAIMANT_AUTHORITY: "Written authority to claim",
  PAYMENT_PROOF: "Payment proof",
  BENEFICIARY_PROOF: "Cancelled cheque or bank statement",
  OTHER: "Other document"
};

/**
 * Evidence staff can ask for case by case, as picker options.
 *
 * Deliberately not the whole document list: the standard requirements are
 * already on every checklist, and offering them here would let a reviewer
 * "request" something the client was asked for at filing.
 */
export const conditionalDocumentOptions: Array<{ value: ClaimDocumentCategory; label: string }> = [
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
].map((category) => ({
  value: category as ClaimDocumentCategory,
  label: claimDocumentLabels[category as ClaimDocumentCategory]
}));

/** Turns an enum value into readable text without a lookup table. */
export function claimLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Statuses whose wording is not just their stored value title-cased.
 * Everything else falls through to `claimLabel`.
 */
const claimStatusOverrides: Partial<Record<ClaimStatus, string>> = {
  NEEDS_INFORMATION: "Information Requested",
  SUBMITTED_TO_CARRIER: "Submitted to Carrier"
};

/**
 * The status as a client should read it.
 *
 * A decided claim reads as "Approved" or "Rejected" rather than "Decided" — the
 * outcome is the part anyone wants, and a partial approval is still an approval
 * in the headline; the settled amount tells the rest. Mirrors
 * `claimStatusLabel` on the server so both sides say the same word.
 */
export function claimStatusText(status: ClaimStatus, decisionOutcome?: ClaimDecisionOutcome | null) {
  if (status === "DECIDED" && decisionOutcome) {
    return decisionOutcome === "REJECTED" ? "Rejected" : "Approved";
  }

  return claimStatusOverrides[status] ?? claimLabel(status);
}

export type ClaimAffectedItem = {
  parcelSequence: number;
  itemIndex: number;
  descriptionSnapshot: string;
  quantityShipped: number;
  quantityAffected: number;
  declaredUnitValueMinor: number;
  clientNarrative: string;
};

export type ClaimSnapshotItem = {
  itemIndex: number;
  description: string;
  hsnCode: string;
  unitType: string;
  quantity: number;
  unitRateMinor: number;
  lineValueMinor: number;
};

export type ClaimSnapshotParcel = {
  sequence: number;
  weightKg: number;
  contentsDescription: string;
  declaredValueMinor: number;
  items: ClaimSnapshotItem[];
};

export type ClaimShipmentSnapshot = {
  trackingNumber: string;
  carrierTrackingNumber: string;
  bookedAt: string;
  deliveredAt: string | null;
  serviceName: string;
  originCountryCode: string;
  destinationCountryCode: string;
  consignorName: string;
  consigneeName: string;
  parcelCount: number;
  totalDeclaredValueMinor: number;
  parcels: ClaimSnapshotParcel[];
  capturedAt: string;
};

export type Claim = {
  id: string;
  claimNumber: string | null;
  status: ClaimStatus;
  submissionStage: "PRELIMINARY" | "FORMAL_COMPLETE";
  category: ClaimCategory;
  shipmentDraftId: string;
  branchId: string;
  linkedSupportTicketId: string | null;
  linkedPodDisputeId: string | null;
  decisionOutcome: ClaimDecisionOutcome | null;
  acceptanceState: "NOT_REQUIRED" | "PENDING" | "ACCEPTED" | "DISPUTED";
  appealState: "NONE" | "SUBMITTED" | "UNDER_REVIEW" | "RESOLVED";
  incidentDate: string | null;
  description: string;
  packagingCondition: string;
  affectedItems: ClaimAffectedItem[];
  affectedParcelSequences: number[];
  shipmentSnapshot: ClaimShipmentSnapshot | null;
  deadlines: {
    filingBasis: "BOOKING" | "DELIVERY";
    filingDeadlineAt: string;
    evidenceDeadlineAt: string | null;
    appealDeadlineAt: string | null;
    internalReviewDueAt: string | null;
    filedLate: boolean;
  } | null;
  submittedAt: string | null;
  decidedAt: string | null;
  settledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Absent for members without financial visibility, which is why every field
  // here is optional rather than nullable.
  currency?: "INR";
  requestedAmountMinor?: number;
  approvedAmountMinor?: number | null;
  paidAmountMinor?: number | null;
};

export type ChecklistItem = {
  category: ClaimDocumentCategory;
  required: boolean;
  state: "MISSING" | "UPLOADED" | "ACCEPTED" | "REJECTED" | "WAIVED" | "SOURCED_FROM_PORTAL";
  documentId: string | null;
  rejectionReason: string;
};

export type ClaimChecklist = {
  items: ChecklistItem[];
  complete: boolean;
  missingCount: number;
  rejectedCount: number;
};

export type ClaimDocumentSummary = {
  _id: string;
  category: ClaimDocumentCategory;
  originalName: string;
  mimeType: string;
  size: number;
  reviewState: "PENDING" | "ACCEPTED" | "REJECTED" | "REPLACED";
  rejectionReason: string;
  createdAt: string;
};

export type ClaimMessageItem = {
  _id: string;
  authorKind: "CLIENT" | "STAFF";
  body: string;
  visibility: "PUBLIC" | "INTERNAL";
  createdAt: string;
};

export type ClaimEventItem = {
  _id: string;
  type: string;
  fromStatus: ClaimStatus | null;
  toStatus: ClaimStatus | null;
  actorKind: "CLIENT" | "STAFF" | "SYSTEM";
  reason: string;
  createdAt: string;
};

export type ClaimDecisionRecord = {
  _id: string;
  revision: number;
  outcome: ClaimDecisionOutcome;
  requestedAmountMinor: number;
  approvedAmountMinor: number;
  declaredValueMinor: number;
  customerExplanation: string;
  createdAt: string;
};

export type ClaimBeneficiaryRecord = {
  // Mongoose returns `_id` unless it is explicitly excluded, and the verify
  // endpoint needs it. The account number itself is never returned.
  _id: string;
  version: number;
  accountHolderName: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string;
  accountType: "SAVINGS" | "CURRENT";
  state: "SUBMITTED" | "VERIFIED" | "REJECTED" | "SUPERSEDED";
};

export type ClaimDetail = {
  claim: Claim;
  checklist: ClaimChecklist;
  documents: ClaimDocumentSummary[];
  messages: ClaimMessageItem[];
  events: ClaimEventItem[];
  decision: ClaimDecisionRecord | null;
  beneficiary: ClaimBeneficiaryRecord | null;
  availableActions: string[];
};

export type ClaimEligibility = {
  eligible: boolean;
  reason: string | null;
  message: string | null;
  requiresStaffReview: boolean;
  shipment: {
    shipmentDraftId: string;
    trackingNumber: string;
    carrierTrackingNumbers: string[];
    bookedAt: string | null;
    collectedAt: string | null;
    deliveredAt: string | null;
    parcelCount: number;
    businessAccountId: string;
    branchId: string;
  } | null;
};

export type ClaimableShipment = {
  shipmentDraftId: string;
  trackingNumber: string;
  bookedAt: string | null;
  collectedAt: string | null;
  parcelCount: number;
  branchId: string;
};

function root(audience: ClaimAudience) {
  return audience === "client" ? "/api/v1/client/claims" : "/api/v1/claims";
}

/** The list endpoint, so an export targets the same one the table reads. */
export function claimListPath(audience: ClaimAudience) {
  return root(audience);
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

/**
 * Fetches with the access token, retrying once through a refresh.
 *
 * Mirrors the support-ticket client rather than sharing with it, matching how
 * every other feature in this codebase owns its own request helper.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken() ?? (await refreshAccessToken());
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(apiUrl(path), { ...init, headers });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(apiUrl(path), { ...init, headers });
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "Claim request failed.");
  return data as T;
}

export async function listClaims(audience: ClaimAudience, filters: { status?: string } = {}) {
  const url = new URL(apiUrl(root(audience)));
  Object.entries(filters).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, String(value));
  });
  const result = await request<{ claims: Claim[] }>(url.pathname + url.search);
  return result.claims;
}

export async function getClaim(audience: ClaimAudience, claimId: string) {
  return request<ClaimDetail>(`${root(audience)}/${claimId}`);
}

export async function listClaimableShipments(businessAccountId: string) {
  const result = await request<{ shipments: ClaimableShipment[] }>(
    `/api/v1/client/claims/claimable-shipments?businessAccountId=${businessAccountId}`
  );
  return result.shipments;
}

export async function checkEligibility(shipmentDraftId: string) {
  const result = await request<{ eligibility: ClaimEligibility }>(
    `/api/v1/client/claims/eligibility/${shipmentDraftId}`
  );
  return result.eligibility;
}

export async function createClaim(input: {
  shipmentDraftId: string;
  category: ClaimCategory;
  linkedSupportTicketId?: string | null;
  linkedPodDisputeId?: string | null;
}) {
  const result = await request<{ claim: Claim }>("/api/v1/client/claims", json("POST", input));
  return result.claim;
}

export type ClaimDraftInput = {
  category?: ClaimCategory;
  requestedAmountMinor?: number;
  incidentDate?: string | null;
  description?: string;
  packagingCondition?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  affectedParcelSequences?: number[];
  affectedItems?: Array<{
    parcelSequence: number;
    itemIndex: number;
    quantityAffected: number;
    clientNarrative?: string;
  }>;
};

export async function saveClaimDraft(claimId: string, input: ClaimDraftInput) {
  const result = await request<{ claim: Claim }>(
    `/api/v1/client/claims/${claimId}/draft`,
    json("PATCH", input)
  );
  return result.claim;
}

export async function deleteClaimDraft(claimId: string) {
  return request<{ message: string }>(
    `/api/v1/client/claims/${claimId}`,
    { method: "DELETE" }
  );
}

export async function submitClaim(claimId: string) {
  return request<{ claim: Claim; filedLate: boolean; message: string }>(
    `/api/v1/client/claims/${claimId}/submit`,
    json("POST", { declarationAccepted: true })
  );
}

/**
 * Uploads one document.
 *
 * Sent as multipart, so the Content-Type header is deliberately not set — the
 * browser has to add it along with the multipart boundary, and setting it by
 * hand produces a request the server cannot parse.
 */
export async function uploadClaimDocument(
  claimId: string,
  category: ClaimDocumentCategory,
  file: File
) {
  const form = new FormData();
  form.append("category", category);
  form.append("document", file);
  return request<{ documentId: string; message: string }>(
    `/api/v1/client/claims/${claimId}/documents`,
    { method: "POST", body: form }
  );
}

export async function deleteClaimDocument(claimId: string, documentId: string) {
  return request<{ message: string }>(
    `/api/v1/client/claims/${claimId}/documents/${documentId}`,
    { method: "DELETE" }
  );
}

/**
 * Opens a document in a new tab.
 *
 * Fetched with the auth header and handed to the browser as a blob URL, because
 * documents stream through the API rather than sitting behind a signed link a
 * plain `<a href>` could follow.
 */
export async function openClaimDocument(
  audience: ClaimAudience,
  claimId: string,
  documentId: string
) {
  const token = getAccessToken() ?? (await refreshAccessToken());
  const response = await fetch(apiUrl(`${root(audience)}/${claimId}/documents/${documentId}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!response.ok) throw new Error("The document could not be opened.");

  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener");
  // Revoked on a delay so the new tab has time to load it first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function postClaimMessage(audience: ClaimAudience, claimId: string, body: string) {
  return request<{ message: string }>(`${root(audience)}/${claimId}/messages`, json("POST", { body }));
}

export async function acceptClaimSettlement(claimId: string) {
  return request<{ claim: Claim }>(`/api/v1/client/claims/${claimId}/accept`, json("POST", {}));
}

export async function appealClaim(claimId: string, reason: string) {
  return request<{ appealId: string }>(
    `/api/v1/client/claims/${claimId}/appeal`,
    json("POST", { reason })
  );
}

export async function submitClaimBeneficiary(
  claimId: string,
  input: {
    accountHolderName: string;
    accountNumber: string;
    confirmAccountNumber: string;
    ifsc: string;
    bankName: string;
    accountType: "SAVINGS" | "CURRENT";
  }
) {
  return request<{ beneficiary: ClaimBeneficiaryRecord }>(
    `/api/v1/client/claims/${claimId}/beneficiary`,
    json("POST", input)
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type ClaimSettlementRecord = {
  _id: string;
  beneficiaryVersion: number;
  approvedAmountMinor: number;
  paidAmountMinor: number;
  transactionReference: string;
  paymentDate: string;
  state: "RECORDED" | "FAILED" | "REVERSED";
  createdAt: string;
};

export type ClaimRecoveryRecord = {
  _id: string;
  partyType: "CARRIER" | "PARTNER" | "INSURER";
  partyName: string;
  externalReference: string;
  submittedAmountMinor: number;
  admittedAmountMinor: number;
  receivedAmountMinor: number;
  state: string;
  filedOutsideCarrierWindow: boolean;
  followUpAt: string | null;
  notes: string;
};

/** The staff view carries everything the client view does, plus the internals. */
export type StaffClaimDetail = Omit<ClaimDetail, "decision"> & {
  decisions: ClaimDecisionRecord[];
  settlements: ClaimSettlementRecord[];
  recoveries: ClaimRecoveryRecord[];
  /** Split into Swiftline, client, and third-party time. */
  sla: {
    totalHours: number;
    swiftlineHours: number;
    clientHours: number;
    thirdPartyHours: number;
    breached: boolean;
    hoursUntilReviewDue: number | null;
  };
  legalHold: { active: boolean; reason: string };
};

export type StaffClaimFilters = {
  status?: string;
  category?: string;
  decisionOutcome?: string;
  recoveryState?: string;
  businessAccountId?: string;
  branchId?: string;
  assignedTo?: string;
  /** Matches claim number or tracking number, as a prefix. */
  search?: string;
  submittedFrom?: string;
  submittedTo?: string;
  minAmountMinor?: string;
  maxAmountMinor?: string;
  settled?: string;
  slaOverdue?: string;
};

/** Queue rows carry resolved names so the table never shows a raw object id. */
export type StaffQueueClaim = Claim & {
  assignedTo: string | null;
  assignedToName: string;
  businessAccountName: string;
  businessAccountCode: string;
  branchName: string;
  branchCode: string;
  affectedParcelCount: number;
  filedLate: boolean;
};

export async function listStaffClaims(filters: StaffClaimFilters = {}) {
  const url = new URL(apiUrl("/api/v1/claims"));
  Object.entries(filters).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, String(value));
  });
  const result = await request<{ claims: StaffQueueClaim[] }>(url.pathname + url.search);
  return result.claims;
}

export async function getStaffClaim(claimId: string) {
  return request<StaffClaimDetail>(`/api/v1/claims/${claimId}`);
}

/**
 * The staff review transitions.
 *
 * One route each rather than a single call taking a transition name — the server
 * is built the same way, deliberately, so that no endpoint can set a status
 * without its own preconditions.
 */
export const claimWorkflowActions = {
  START_REVIEW: { path: "start-review", label: "Start review", needsReason: false },
  REQUEST_DOCUMENTS: { path: "request-documents", label: "Request documents", needsReason: true },
  COMPLETE_DOCUMENTS: { path: "complete-documents", label: "Evidence complete", needsReason: false },
  REQUEST_INFORMATION: { path: "request-information", label: "Request information", needsReason: true },
  RECEIVE_INFORMATION: { path: "receive-information", label: "Information received", needsReason: false },
  AWAIT_THIRD_PARTY: { path: "await-third-party", label: "Awaiting third party", needsReason: true },
  THIRD_PARTY_RESPONDED: { path: "third-party-responded", label: "Third party replied", needsReason: false },
  SEND_FOR_APPROVAL: { path: "send-for-approval", label: "Send for approval", needsReason: false },
  CLOSE: { path: "close", label: "Close claim", needsReason: false },
  REOPEN: { path: "reopen", label: "Reopen claim", needsReason: true },
  WITHDRAW: { path: "withdraw", label: "Withdraw claim", needsReason: true }
} as const;

export type ClaimWorkflowAction = keyof typeof claimWorkflowActions;

export async function runClaimWorkflowAction(
  claimId: string,
  action: ClaimWorkflowAction,
  reason?: string
) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/${claimWorkflowActions[action].path}`,
    json("POST", { reason: reason ?? "" })
  );
}

/** Staff attach payment proof and internal evidence through their own route. */
export async function uploadStaffClaimDocument(
  claimId: string,
  category: ClaimDocumentCategory,
  file: File,
  options: { storageType?: "evidence" | "payment-proof" | "beneficiary" } = {}
) {
  const form = new FormData();
  form.append("category", category);
  if (options.storageType) form.append("storageType", options.storageType);
  form.append("document", file);
  return request<{ documentId: string; message: string }>(
    `/api/v1/claims/${claimId}/documents`,
    { method: "POST", body: form }
  );
}

export async function withdrawClaim(claimId: string, reason: string) {
  return request<{ message: string }>(
    `/api/v1/client/claims/${claimId}/withdraw`,
    json("POST", { reason })
  );
}

export async function disputeClaimSettlement(claimId: string, reason: string) {
  return request<{ message: string }>(
    `/api/v1/client/claims/${claimId}/dispute`,
    json("POST", { reason })
  );
}

/** Waive a required document. Admin and operations only. */
export async function waiveClaimDocument(claimId: string, category: ClaimDocumentCategory, reason: string) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/documents/waive`,
    json("POST", { category, reason })
  );
}

/** Ask the client for evidence beyond the standard list for their category. */
export async function requestConditionalDocuments(
  claimId: string,
  categories: ClaimDocumentCategory[],
  reason: string
) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/documents/request`,
    json("POST", { categories, reason })
  );
}

/** Place or lift a legal hold. Admin only; suspends the retention purge. */
export async function setClaimLegalHold(claimId: string, hold: boolean, reason: string) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/legal-hold`,
    json("POST", { hold, reason })
  );
}

/** Opens the decision letter PDF in a new tab. */
export async function openDecisionLetter(audience: ClaimAudience, claimId: string) {
  const token = getAccessToken() ?? (await refreshAccessToken());
  const response = await fetch(apiUrl(`${root(audience)}/${claimId}/decision-letter`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!response.ok) throw new Error("The decision letter could not be opened.");

  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function assignClaim(claimId: string, assignedTo: string | null) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/assign`,
    json("POST", { assignedTo })
  );
}

export async function decideClaim(
  claimId: string,
  input: {
    outcome: ClaimDecisionOutcome;
    approvedAmountMinor: number;
    reasonCode: string;
    customerExplanation: string;
    internalNote?: string;
  }
) {
  return request<{ claim: Claim }>(`/api/v1/claims/${claimId}/decisions`, json("POST", input));
}

export async function reviewClaimDocument(
  claimId: string,
  documentId: string,
  input: { decision: "ACCEPTED" | "REJECTED"; reason?: string }
) {
  return request<{ message: string }>(
    `/api/v1/claims/${claimId}/documents/${documentId}/review`,
    json("POST", input)
  );
}

export async function verifyClaimBeneficiary(
  claimId: string,
  beneficiaryId: string,
  input: { approved: boolean; reason?: string }
) {
  return request<{ state: string }>(
    `/api/v1/claims/${claimId}/beneficiary/${beneficiaryId}/verify`,
    json("POST", input)
  );
}

/**
 * Reveals the full bank account number to someone about to pay it.
 *
 * POST rather than GET so it never reaches browser history or a proxy log, and
 * every reveal is audited server-side. The value is held in component state
 * only, never cached.
 */
export async function revealClaimBeneficiary(claimId: string, beneficiaryId: string) {
  return request<{
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string;
    accountType: string;
  }>(`/api/v1/claims/${claimId}/beneficiary/${beneficiaryId}/reveal`, json("POST", {}));
}

export async function recordClaimSettlement(
  claimId: string,
  input: {
    paidAmountMinor: number;
    transactionReference: string;
    paymentDate: string;
    proofDocumentId: string;
    idempotencyKey: string;
  }
) {
  return request<{ claim: Claim; message: string }>(
    `/api/v1/claims/${claimId}/settlements`,
    json("POST", input)
  );
}

export async function saveClaimRecovery(
  claimId: string,
  input: {
    recoveryId?: string;
    partyType: "CARRIER" | "PARTNER" | "INSURER";
    partyName: string;
    externalReference?: string;
    submittedAmountMinor?: number;
    admittedAmountMinor?: number;
    receivedAmountMinor?: number;
    notes?: string;
  }
) {
  return request<{ recovery: ClaimRecoveryRecord }>(
    `/api/v1/claims/${claimId}/recoveries`,
    json("POST", input)
  );
}

/** Integer paise to a displayable rupee string. */
export function formatClaimAmount(minor: number | null | undefined) {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(minor / 100);
}

/** Rupees typed into a form back to the integer paise the API expects. */
export function toMinorUnits(rupees: string) {
  const parsed = Number(rupees.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}
