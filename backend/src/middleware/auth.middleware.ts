import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/auth.service.js";
import { User } from "../models/user.model.js";
import { normalizePortalRole } from "../utils/portalRole.js";

export async function attachUser(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) return next();

    const token = header.replace("Bearer ", "");

    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.sub)
      .select("email role name hasSeenWelcome assignedBranches")
      .lean()
      .exec();

    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = { ...user, role: normalizePortalRole(user.role) };
    }
  } catch (error) {
    // ignore invalid token
  }

  return next();
}

// Rejects anonymous requests without constraining the role. Use after attachUser
// on resources any signed-in user may read.
export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(req as any).user) return res.status(401).json({ success: false, message: "Unauthorized" });

  return next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user;

    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!roles.includes(user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return next();
  };
}
