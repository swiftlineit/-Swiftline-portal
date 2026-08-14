import { Router } from "express";
import { listUsers, createUser, listUserBranchOptions, unlockUser, updateUserAccess, updateUserStatus } from "../controllers/user.controller.js";
import { createStaffUser, getStaffUser, updateStaffUser, viewStaffDocument, viewStaffProfileImage } from "../controllers/staff.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { staffDocumentUpload } from "../middleware/staffDocumentUpload.middleware.js";
import { listUserSessions, terminateUserSessions } from "../controllers/userSession.controller.js";
import {
  approveClientAccessRequest,
  completeClientAccessRequest,
  declineClientAccessRequest,
  listClientAccessRequests
} from "../controllers/clientAccessRequest.controller.js";

export const userRouter = Router();

userRouter.use(attachUser);
// HR owns the staff directory: it may read the list and add staff members. Every
// route that changes an existing user's role, branches, or login status stays
// admin-only, so HR cannot promote anyone (including itself) to admin.
userRouter.use(requireRole("admin", "hr"));

const requireAdmin = requireRole("admin");

userRouter.get("/", listUsers);
// Two static segments, so this cannot be captured by the "/:id" route below.
userRouter.get("/branches/options", listUserBranchOptions);
// Client login requests raised by a business account administrator. Approval
// creates a real login, so these stay admin-only rather than HR-visible.
userRouter.get("/access-requests", requireAdmin, listClientAccessRequests);
userRouter.post("/access-requests/:requestId/approve", requireAdmin, approveClientAccessRequest);
userRouter.post("/access-requests/:requestId/complete", requireAdmin, completeClientAccessRequest);
userRouter.post("/access-requests/:requestId/decline", requireAdmin, declineClientAccessRequest);
userRouter.post("/staff", staffDocumentUpload, createStaffUser);
userRouter.get("/:id/profile-image", viewStaffProfileImage);
userRouter.get("/:id/documents/:documentType", viewStaffDocument);
userRouter.get("/:id", getStaffUser);
userRouter.patch("/:id/staff", requireAdmin, staffDocumentUpload, updateStaffUser);
userRouter.post("/", requireAdmin, createUser);
userRouter.get("/:id/sessions", requireAdmin, listUserSessions);
// Lets an admin free an account whose only active session is on a device the
// user no longer has.
userRouter.delete("/:id/sessions", requireAdmin, terminateUserSessions);
userRouter.patch("/:id/unlock", requireAdmin, unlockUser);
userRouter.patch("/:id/status", requireAdmin, updateUserStatus);
userRouter.patch("/:id/access", requireAdmin, updateUserAccess);
