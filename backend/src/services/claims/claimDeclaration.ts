/**
 * The declaration a client accepts when filing a claim.
 *
 * PROVISIONAL. This wording was drafted from the approved specification's six
 * points, not supplied by Legal. It is stored against every claim it was shown
 * with, so the version string matters:
 *
 *   "1.0-draft"  this text
 *   "1.0"        the first Legal-approved wording
 *
 * Keeping "-draft" in the version means every claim filed against placeholder
 * text stays findable — `Claim.find({ declarationVersion: /-draft$/ })` — which
 * is what you would need if Legal's wording differs materially and those claims
 * have to be re-confirmed. A version string of "1.0" for both would make that
 * distinction unrecoverable.
 */

export const currentDeclarationVersion = "1.0-draft";

/** True while the wording shown to clients has not been through Legal. */
export const declarationIsProvisional = currentDeclarationVersion.endsWith("-draft");

export const declarationPoints = [
  "The information I have given in this claim is accurate and complete to the best of my knowledge.",
  "The documents and photographs I have supplied are genuine and relate to this shipment.",
  "This loss has not been, and will not be, compensated by any insurer, carrier, or other party.",
  "Swiftline may contact the carrier, its agents, and any partner involved in this shipment to investigate this claim.",
  "I will retain the goods and their packaging in their current condition until Swiftline confirms no inspection is required.",
  "Any bank details I provide for settlement will be verified by Swiftline before any payment is made."
] as const;

/**
 * The full text stored alongside the claim.
 *
 * Recorded verbatim rather than by reference so that a claim opened years later
 * shows what was actually agreed, even after the wording changes.
 */
export function declarationText() {
  return declarationPoints.join("\n");
}
