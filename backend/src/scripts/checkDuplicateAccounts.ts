/**
 * Reports business accounts that would violate the uniqueness indexes.
 *
 * Those indexes are partial and skip rejected accounts, so this applies exactly
 * the same filter. MongoDB refuses to build a unique index over a collection
 * that already contains duplicates, and the failure surfaces at startup- so
 * run this and clear anything it reports before deploying.
 *
 *   npm run check:duplicate-accounts
 *
 * Read-only: it changes nothing, it only tells you what to look at.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BusinessAccount } from "../models/businessAccount.model.js";

type DuplicateGroup = {
  _id: Record<string, unknown>;
  count: number;
  accounts: { accountId: string; status: string; createdAt: Date }[];
};

const liveOnly = { status: { $ne: "rejected" } };

async function findDuplicates(label: string, groupBy: Record<string, string>, extraMatch: Record<string, unknown> = {}) {
  const groups = await BusinessAccount.aggregate<DuplicateGroup>([
    { $match: { ...liveOnly, ...extraMatch } },
    {
      $group: {
        _id: groupBy,
        count: { $sum: 1 },
        accounts: { $push: { accountId: "$accountId", status: "$status", createdAt: "$createdAt" } }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]).exec();

  if (!groups.length) {
    console.log(`  OK    ${label}: no duplicates`);
    return 0;
  }

  console.log(`  CLASH ${label}: ${groups.length} duplicated value(s)`);

  for (const group of groups) {
    const value = Object.values(group._id).filter(Boolean).join(" ");
    console.log(`        "${value}" is used by ${group.count} accounts:`);

    for (const account of group.accounts) {
      const created = account.createdAt ? new Date(account.createdAt).toISOString().slice(0, 10) : "unknown";
      console.log(`          - ${account.accountId}  status=${account.status}  created=${created}`);
    }
  }

  return groups.length;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Checking business accounts against the uniqueness rules (rejected accounts excluded)\n");

  const clashes =
    await findDuplicates("contact.email", { email: "$contact.email" })
    + await findDuplicates("contact country code + mobile", {
      countryCode: "$contact.countryCode",
      mobileNumber: "$contact.mobileNumber"
    })
    + await findDuplicates(
      "company.registrationIdKey",
      { registrationIdKey: "$company.registrationIdKey" },
      // Matches the index's partial filter: blank keys are not compared.
      { "company.registrationIdKey": { $type: "string", $gt: "" } }
    );

  console.log();

  if (clashes) {
    console.log(`${clashes} duplicated value(s) found. The unique indexes cannot build until these are resolved:`);
    console.log("  - reject or delete the accounts that should not exist, or");
    console.log("  - correct the duplicated email, mobile or registration ID.");
  } else {
    console.log("No duplicates. The uniqueness indexes will build cleanly.");
  }

  await mongoose.disconnect();
  process.exit(clashes ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Duplicate check failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
