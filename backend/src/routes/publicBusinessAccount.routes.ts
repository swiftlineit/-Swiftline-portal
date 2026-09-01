import { Router } from "express";
import {
  createPublicBusinessAccount,
  requestPublicBusinessAccountEmailOtp,
  validatePublicBusinessAccountUniqueness,
  verifyPublicBusinessAccountEmailOtp
} from "../controllers/publicBusinessAccount.controller.js";
import {
  publicBusinessAccountCreateLimiter,
  publicBusinessAccountHourlyLimiter,
  publicBusinessAccountLimiter,
  publicEmailOtpRequestLimiter,
  publicEmailOtpVerifyLimiter
} from "../middleware/rateLimit.middleware.js";
import { businessDocumentUpload } from "../middleware/businessDocumentUpload.middleware.js";

export const publicBusinessAccountRouter = Router();

// Public — no attachUser, no requireRole. Two-bucket burst+hourly limiter.
publicBusinessAccountRouter.use(publicBusinessAccountLimiter);
publicBusinessAccountRouter.use(publicBusinessAccountHourlyLimiter);

// Unique checks public
publicBusinessAccountRouter.get("/validate-unique", validatePublicBusinessAccountUniqueness);

// Email OTP
publicBusinessAccountRouter.post("/email-otp/request", publicEmailOtpRequestLimiter, requestPublicBusinessAccountEmailOtp);
publicBusinessAccountRouter.post("/email-otp/verify", publicEmailOtpVerifyLimiter, verifyPublicBusinessAccountEmailOtp);

// Create — multipart + strict limiter
publicBusinessAccountRouter.post("/", publicBusinessAccountCreateLimiter, businessDocumentUpload, createPublicBusinessAccount);
