import type { ClientDashboardAccount } from "@/lib/clientDashboard";

export function canCreateShipment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations"].includes(account.membership.role)
    && account.assignedBranches.length > 0;
}

export function canRequestQuote(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations"].includes(account.membership.role);
}

export function hasQuoteAccess(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations", "finance"].includes(account.membership.role);
}

export function canMakePayment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "finance"].includes(account.membership.role);
}

export function getBranchLabel(branch?: { name?: string; code?: string } | null) {
  if (!branch) return "Account-level access";
  return `${branch.name || "Branch"}${branch.code ? ` (${branch.code})` : ""}`;
}
