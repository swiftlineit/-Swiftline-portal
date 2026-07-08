import { Router } from "express";
import { login, logout, me, refresh, markWelcomeSeen } from "../controllers/auth.controller.js";
import { attachUser } from "../middleware/auth.middleware.js";
import { loginLimiter } from "../middleware/rateLimit.middleware.js";

export const authRouter = Router();

authRouter.post("/login", loginLimiter, login);
authRouter.post("/logout", logout);
authRouter.post("/refresh", refresh);
authRouter.get("/me", attachUser, me);
authRouter.patch("/welcome-seen", attachUser, markWelcomeSeen);
