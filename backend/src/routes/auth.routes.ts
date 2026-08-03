import { Router } from "express";
import {
  activateInvitation,
  getInvitation,
  login,
  loginWithGoogle,
  logout,
  markWelcomeSeen,
  me,
  refresh,
  requestLoginOtp,
  requestPasswordReset,
  resetPassword,
  verifyLoginOtp
} from "../controllers/auth.controller.js";
import { attachUser } from "../middleware/auth.middleware.js";
import { loginLimiter, otpRequestLimiter } from "../middleware/rateLimit.middleware.js";

export const authRouter = Router();

authRouter.post("/login", loginLimiter, login);
authRouter.post("/login/google", loginLimiter, loginWithGoogle);
authRouter.post("/login/otp/request", otpRequestLimiter, requestLoginOtp);
authRouter.post("/login/otp/verify", loginLimiter, verifyLoginOtp);
authRouter.post("/logout", logout);
authRouter.post("/refresh", refresh);
authRouter.post("/forgot-password", loginLimiter, requestPasswordReset);
authRouter.post("/reset-password", loginLimiter, resetPassword);
authRouter.get("/invitations/:token", getInvitation);
authRouter.post("/activate-invitation", activateInvitation);
authRouter.get("/me", attachUser, me);
authRouter.patch("/welcome-seen", attachUser, markWelcomeSeen);
