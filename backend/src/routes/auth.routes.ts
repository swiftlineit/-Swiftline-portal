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
import {
  googleLoginLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  passwordLoginAccountLimiter,
  passwordLoginNetworkLimiter,
  passwordResetLimiter,
  passwordResetRequestLimiter
} from "../middleware/rateLimit.middleware.js";

export const authRouter = Router();

authRouter.post("/login", passwordLoginNetworkLimiter, passwordLoginAccountLimiter, login);
authRouter.post("/login/google", googleLoginLimiter, loginWithGoogle);
authRouter.post("/login/otp/request", otpRequestLimiter, requestLoginOtp);
authRouter.post("/login/otp/verify", otpVerifyLimiter, verifyLoginOtp);
authRouter.post("/logout", logout);
authRouter.post("/refresh", refresh);
authRouter.post("/forgot-password", passwordResetRequestLimiter, requestPasswordReset);
authRouter.post("/reset-password", passwordResetLimiter, resetPassword);
authRouter.get("/invitations/:token", getInvitation);
authRouter.post("/activate-invitation", activateInvitation);
authRouter.get("/me", attachUser, me);
authRouter.patch("/welcome-seen", attachUser, markWelcomeSeen);
