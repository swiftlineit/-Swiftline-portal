import { Router } from "express";
import {
  createBranch, deleteBranchDocument, deleteBranchDraft, deleteBranchImage, getBranch, listBranches,
  updateBranch, updateBranchStatus, uploadBranchDocument, uploadBranchImages, validateBranchCode,
  viewBranchDocument, viewBranchImage
} from "../controllers/branch.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { requireBranchAccess } from "../middleware/branchAccess.middleware.js";
import { getBranchFinanceSummary, getBranchUsers } from "../controllers/branchReporting.controller.js";
import { branchUpload } from "../middleware/branchUpload.middleware.js";

export const branchRouter = Router();

branchRouter.use(attachUser);
// Operations, finance and HR read only their assigned branches for their own
// tab-specific work. Changing the branch network stays an admin governance
// action, so every write below re-checks with the narrower guard.
branchRouter.use(requireRole("admin", "operations", "finance", "hr"));

const requireAdmin = requireRole("admin");

branchRouter.get("/", listBranches);
branchRouter.get("/validate-code", requireAdmin, validateBranchCode);
branchRouter.post("/", requireAdmin, createBranch);
branchRouter.get(
  "/:branchId/finance-summary",
  requireRole("admin", "operations", "finance"),
  requireBranchAccess,
  getBranchFinanceSummary
);
branchRouter.get(
  "/:branchId/users",
  requireRole("admin", "operations", "hr"),
  requireBranchAccess,
  getBranchUsers
);
branchRouter.get("/:branchId", requireBranchAccess, getBranch);
branchRouter.patch("/:branchId", requireAdmin, updateBranch);
branchRouter.patch("/:branchId/status", requireAdmin, updateBranchStatus);
// Draft branches only; an activated branch is retired through the status
// endpoint above so its history survives.
branchRouter.delete("/:branchId", requireAdmin, deleteBranchDraft);
branchRouter.post("/:branchId/images", requireAdmin, branchUpload, uploadBranchImages);
// Reads follow the same branch scoping as the rest of the branch record. These
// replace the blanket static mount over `private_uploads`, under which any
// authenticated user could fetch any document by guessing its path.
branchRouter.get("/:branchId/images/:imageIndex", requireBranchAccess, viewBranchImage);
branchRouter.delete("/:branchId/images/:imageIndex", requireAdmin, deleteBranchImage);
branchRouter.post("/:branchId/documents", requireAdmin, branchUpload, uploadBranchDocument);
branchRouter.get("/:branchId/documents/:docIndex", requireBranchAccess, viewBranchDocument);
branchRouter.delete("/:branchId/documents/:docIndex", requireAdmin, deleteBranchDocument);
