import { Router } from "express";
import {
  createBranch, deleteBranchDocument, deleteBranchDraft, deleteBranchImage, getBranch, listBranches,
  updateBranch, updateBranchStatus, uploadBranchDocument, uploadBranchImages, validateBranchCode
} from "../controllers/branch.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { branchUpload } from "../middleware/branchUpload.middleware.js";

export const branchRouter = Router();

branchRouter.use(attachUser);
// Operations reads the branch list: the shipment booking flow and the business
// account branch picker both need it. Changing the branch network stays a
// governance action, so every write below re-checks with the narrower guard.
branchRouter.use(requireRole("admin", "operations"));

const requireAdmin = requireRole("admin");

branchRouter.get("/", listBranches);
branchRouter.get("/validate-code", requireAdmin, validateBranchCode);
branchRouter.post("/", requireAdmin, createBranch);
branchRouter.get("/:branchId", getBranch);
branchRouter.patch("/:branchId", requireAdmin, updateBranch);
branchRouter.patch("/:branchId/status", requireAdmin, updateBranchStatus);
// Draft branches only; an activated branch is retired through the status
// endpoint above so its history survives.
branchRouter.delete("/:branchId", requireAdmin, deleteBranchDraft);
branchRouter.post("/:branchId/images", requireAdmin, branchUpload, uploadBranchImages);
branchRouter.delete("/:branchId/images/:imageIndex", requireAdmin, deleteBranchImage);
branchRouter.post("/:branchId/documents", requireAdmin, branchUpload, uploadBranchDocument);
branchRouter.delete("/:branchId/documents/:docIndex", requireAdmin, deleteBranchDocument);

