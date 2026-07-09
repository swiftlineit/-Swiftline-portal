import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === "production" ? 100 : 2000, // keep local development from blocking normal dashboard/API testing
  standardHeaders: true,
  legacyHeaders: false
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 5 : 50,
  message: { success: false, message: "Too many login attempts, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});
