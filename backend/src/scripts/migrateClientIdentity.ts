import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { BusinessAccountInvitation } from "../models/businessAccountInvitation.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { User } from "../models/user.model.js";
import { normalizeUserPhone } from "../services/userIdentity.service.js";

const apply = process.argv.includes("--apply");
const currentStatuses = ["invited", "active", "suspended"];

async function migrateClientIdentity() {
  await connectDatabase();
  try {
    const users = await User.find({}).select("email phone role userStatus").lean().exec();
    const normalizedOwners = new Map<string, Array<{ id: string; email: string; raw: string }>>();
    const invalidClientPhones: Array<{ id: string; email: string; raw: string }> = [];
    const updates: Array<{ updateOne: { filter: { _id: mongoose.Types.ObjectId }; update: { $set: { phone: string } } } }> = [];

    for (const user of users) {
      const raw = String(user.phone ?? "").trim();
      const normalized = normalizeUserPhone(raw);
      if (!normalized) {
        if (user.role === "client") invalidClientPhones.push({ id: String(user._id), email: user.email, raw });
        continue;
      }
      const owners = normalizedOwners.get(normalized) ?? [];
      owners.push({ id: String(user._id), email: user.email, raw });
      normalizedOwners.set(normalized, owners);
      if (normalized !== raw) {
        updates.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(String(user._id)) }, update: { $set: { phone: normalized } } } });
      }
    }

    const duplicatePhones = [...normalizedOwners.entries()].filter(([, owners]) => owners.length > 1);
    const duplicateMemberships = await BusinessAccountMember.aggregate<{
      _id: mongoose.Types.ObjectId;
      memberships: Array<{ id: mongoose.Types.ObjectId; account: mongoose.Types.ObjectId; status: string }>;
      count: number;
    }>([
      { $match: { status: { $in: currentStatuses } } },
      { $group: { _id: "$user", count: { $sum: 1 }, memberships: { $push: { id: "$_id", account: "$businessAccount", status: "$status" } } } },
      { $match: { count: { $gt: 1 } } }
    ]).exec();
    const invitationConflicts = await BusinessAccountInvitation.aggregate<{
      _id: mongoose.Types.ObjectId;
      count: number;
      accounts: mongoose.Types.ObjectId[];
    }>([
      { $match: { acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } } },
      { $group: { _id: "$user", count: { $sum: 1 }, accounts: { $addToSet: "$businessAccount" } } },
      { $match: { count: { $gt: 1 } } }
    ]).exec();

    console.log(`Client identity audit (${apply ? "apply" : "read-only"})`);
    console.log(`  Users scanned: ${users.length}`);
    console.log(`  Phones needing E.164 normalization: ${updates.length}`);
    console.log(`  Client users with missing or invalid phones: ${invalidClientPhones.length}`);
    console.log(`  Duplicate normalized phones: ${duplicatePhones.length}`);
    console.log(`  Users with multiple current memberships: ${duplicateMemberships.length}`);
    console.log(`  Users with multiple live invitations: ${invitationConflicts.length}`);

    for (const user of invalidClientPhones) console.log(`  INVALID PHONE ${user.email} (${user.id}): ${user.raw || "<blank>"}`);
    for (const [phone, owners] of duplicatePhones) console.log(`  DUPLICATE PHONE ${phone}: ${owners.map((owner) => `${owner.email} (${owner.id})`).join(", ")}`);
    for (const conflict of duplicateMemberships) console.log(`  MULTI MEMBERSHIP user=${conflict._id}: ${conflict.memberships.map((item) => `${item.account}:${item.status}`).join(", ")}`);
    for (const conflict of invitationConflicts) console.log(`  MULTI INVITATION user=${conflict._id}: ${conflict.accounts.join(", ")}`);

    const blockers = invalidClientPhones.length + duplicatePhones.length + duplicateMemberships.length + invitationConflicts.length;
    if (!apply) {
      if (blockers) process.exitCode = 1;
      return;
    }
    if (blockers) throw new Error("Resolve every reported identity conflict before applying unique indexes.");

    if (updates.length) await User.bulkWrite(updates, { ordered: false });

    const memberIndexes = await BusinessAccountMember.collection.indexes();
    const oldMembershipIndex = memberIndexes.find((index) =>
      index.unique && index.key?.businessAccount === 1 && index.key?.user === 1
    );
    if (oldMembershipIndex?.name) await BusinessAccountMember.collection.dropIndex(oldMembershipIndex.name);

    await Promise.all([User.createIndexes(), BusinessAccountMember.createIndexes()]);
    console.log("Client identities normalized and unique identity indexes created.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateClientIdentity().catch((error) => {
  console.error("Client identity migration failed.", error);
  process.exitCode = 1;
});
