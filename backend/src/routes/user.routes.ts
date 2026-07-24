import { Router } from "express";
import { listUsers, createUser, listUserBranchOptions, unlockUser, updateUserAccess, updateUserStatus } from "../controllers/user.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const userRouter = Router();

userRouter.use(attachUser);
userRouter.use(requireRole("admin"));

userRouter.get("/", listUsers);
userRouter.get("/branches/options", listUserBranchOptions);
userRouter.post("/", createUser);
userRouter.patch("/:id/unlock", unlockUser);
userRouter.patch("/:id/status", updateUserStatus);
userRouter.patch("/:id/access", updateUserAccess);
