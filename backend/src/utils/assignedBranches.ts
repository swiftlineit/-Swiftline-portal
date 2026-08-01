import mongoose from "mongoose";
import { Branch } from "../models/branch.model.js";

/**
 * Resolve the branch ids a user may be assigned to.
 *
 * Returns null when any id is malformed or does not name an ACTIVE branch, so
 * callers reject the request instead of silently dropping access.
 */
export async function validateAssignedBranches(values: string[]) {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.some((value) => !mongoose.Types.ObjectId.isValid(value))) return null;
  if (!uniqueValues.length) return [];
  const branches = await Branch.find({ _id: { $in: uniqueValues }, status: "ACTIVE" }).select("_id").lean().exec();
  return branches.length === uniqueValues.length ? branches.map((branch) => branch._id) : null;
}
