import { Router } from "express";
import { createBranch, getBranch, listBranches, updateBranch, validateBranchCode } from "../controllers/branch.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const branchRouter = Router();

branchRouter.use(attachUser);
branchRouter.use(requireRole("admin"));

branchRouter.get("/", listBranches);
branchRouter.get("/validate-code", validateBranchCode);
branchRouter.post("/", createBranch);
branchRouter.get("/:branchId", getBranch);
branchRouter.patch("/:branchId", updateBranch);
