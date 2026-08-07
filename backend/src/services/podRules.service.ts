export type PodEvidenceRuleInput = { type: string };

/** A POD may cover many parcels, but never a parcel outside its one assignment. */
export function podParcelsBelongToAssignment(assignmentParcels: string[], selectedParcels: string[]) {
  if (!selectedParcels.length) return false;
  const allowed = new Set(assignmentParcels);
  return selectedParcels.every((parcel) => allowed.has(parcel)) && new Set(selectedParcels).size === selectedParcels.length;
}

/** Successful delivery always needs a photo and either a signature or approved exception. */
export function podEvidenceRequirements(evidence: PodEvidenceRuleInput[], signatureExceptionStatus: string) {
  return { hasPhoto: evidence.some((item) => item.type === "PHOTO"), hasSignature: evidence.some((item) => item.type === "SIGNATURE") || signatureExceptionStatus === "APPROVED" };
}

export function canReassignPod(status: string) { return !["DELIVERED", "CANCELLED", "RETURNED"].includes(status); }
export function podRetentionUntil(verifiedAt: Date) { const value = new Date(verifiedAt); value.setUTCFullYear(value.getUTCFullYear() + 8); return value; }
