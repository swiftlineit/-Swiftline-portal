import type { Role } from "../models/user.model.js";

export function normalizePortalRole(role: unknown): Role {
  return role === "staff" ? "operations" : role as Role;
}
