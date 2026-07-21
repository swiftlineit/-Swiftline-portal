import { Router } from "express";
import { listUsers, createUser, unlockUser, updateUserStatus, changeRole } from "../controllers/user.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const userRouter = Router();

userRouter.use(attachUser);
userRouter.use(requireRole("admin"));

userRouter.get("/", listUsers);
userRouter.post("/", createUser);
userRouter.patch("/:id/unlock", unlockUser);
userRouter.patch("/:id/status", updateUserStatus);
userRouter.patch("/:id/role", changeRole);
