import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env.js";

function isOperationsScannerRequest(path: string) {
  return /^\/api\/v1\/operations-manifests\/(?:scan-sessions(?:\/|$)|[^/]+\/(?:scan|scan-feed|scan-sessions)(?:\/|$))/.test(path);
}

function authenticatedScannerKey(request: Request) {
  const userId = String((request as typeof request & { user?: { _id?: unknown } }).user?._id ?? "anonymous");
  const sessionId = String(request.params?.sessionId ?? request.body?.sessionId ?? "no-session");
  return `${userId}:${sessionId}`;
}

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === "production" ? 1200 : 20000, // dashboards poll; a per-IP cap of 100 logs real operators out
  // Every limiter must answer with the portal JSON envelope. A plain-text 429
  // makes the browser clients fail `response.json()` and treat it as a signed-out session.
  message: { success: false, message: "Too many requests. Wait a moment and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (request) => isOperationsScannerRequest(request.path)
});

export const scannerPairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 10 : 100,
  keyGenerator: authenticatedScannerKey,
  message: { success: false, message: "Too many phone pairing attempts. Wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false
});

export const scannerScanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === "production" ? 120 : 1000,
  keyGenerator: authenticatedScannerKey,
  message: { success: false, message: "This scanner is sending parcels too quickly. Pause briefly and try again." },
  standardHeaders: true,
  legacyHeaders: false
});

export const scannerFeedLimiter = rateLimit({
  windowMs: 60 * 1000,
  // A paired station polls session status from both the laptop and the phone,
  // so the ceiling has to sit clear of their combined steady-state rate.
  max: env.NODE_ENV === "production" ? 180 : 1000,
  keyGenerator: authenticatedScannerKey,
  message: { success: false, message: "Manifest updates are being requested too quickly." },
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
