import { legacyRoleReplacements, type Role } from "../models/user.model.js";

// Translate a role read from the database into the role name the product uses
// today. Documents written before a rename ("staff", "accounts") are still on
// disk, so every read path normalizes before comparing or returning a role.
export function normalizePortalRole(role: unknown): Role {
  if (typeof role !== "string") return role as Role;

  return legacyRoleReplacements[role] ?? role as Role;
}
