"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FiShield } from "react-icons/fi";
import { checkEligibility, type ClaimEligibility } from "@/lib/claims";

/**
 * The "Raise a claim" action on a shipment.
 *
 * Asks the server whether this shipment can be claimed for rather than guessing
 * from status: eligibility depends on collection events, cancellations, branch
 * access, and whether a claim is already open, and duplicating that logic here
 * would eventually disagree with the server that enforces it.
 *
 * Renders nothing at all while the answer is unknown or when the shipment was
 * never in a position to be claimed for — a permanently greyed-out button on
 * every shipment is noise.
 */
export default function RaiseClaimButton({ shipmentDraftId }: { shipmentDraftId: string }) {
  const [eligibility, setEligibility] = useState<ClaimEligibility | null>(null);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        setEligibility(await checkEligibility(shipmentDraftId));
      } catch {
        // A shipment the caller cannot reach answers not-found. Nothing to show,
        // and nothing worth surfacing as an error on a page about something else.
        setEligibility(null);
      }
    });
  }, [shipmentDraftId]);

  if (!eligibility) return null;

  if (eligibility.eligible) {
    return (
      <Link
        href={`/client/claims/new?shipmentId=${shipmentDraftId}`}
        className="inline-flex items-center gap-2 rounded-4xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
      >
        <FiShield aria-hidden="true" className="h-4 w-4" />
        Raise a claim
      </Link>
    );
  }

  // Worth explaining only where the client might reasonably expect to claim.
  // "Not booked" and "not collected" are states they can see for themselves.
  const worthExplaining = ["CLAIM_ALREADY_ACTIVE", "NOT_PERMITTED"];
  if (!eligibility.reason || !worthExplaining.includes(eligibility.reason)) return null;

  return (
    <p className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
      <FiShield aria-hidden="true" className="h-4 w-4 text-slate-400" />
      {eligibility.message}
    </p>
  );
}
