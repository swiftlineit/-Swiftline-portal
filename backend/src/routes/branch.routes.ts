import { Router } from "express";
import {
  createBranch, deleteBranchDocument, deleteBranchImage, getBranch, listBranches,
  updateBranch, updateBranchStatus, uploadBranchDocument, uploadBranchImages, validateBranchCode
} from "../controllers/branch.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { branchUpload } from "../middleware/branchUpload.middleware.js";

export const branchRouter = Router();

branchRouter.use(attachUser);
branchRouter.use(requireRole("admin"));

branchRouter.get("/", listBranches);
branchRouter.get("/validate-code", validateBranchCode);
branchRouter.post("/", createBranch);
branchRouter.get("/:branchId", getBranch);
branchRouter.patch("/:branchId", updateBranch);
branchRouter.patch("/:branchId/status", updateBranchStatus);
branchRouter.post("/:branchId/images", branchUpload, uploadBranchImages);
branchRouter.delete("/:branchId/images/:imageIndex", deleteBranchImage);
branchRouter.post("/:branchId/documents", branchUpload, uploadBranchDocument);
branchRouter.delete("/:branchId/documents/:docIndex", deleteBranchDocument);

