import { Router } from "express";
import {
  addMyPickupException, assignPickupRequestDriver, cancelInternalPickupRequest, completeMyPickupAttempt, confirmPickupRequest,
  getInternalPickupRequest, getMyPickupAttempt, listAvailablePickupDrivers, listInternalPickupRequests, listMyPickupAttempts, requestMyPickupOtp,
  requestMyPickupOtpException, requirePickupManager, reviewPickupRequestOtpException, scanMyPickupParcel,
  updateMyPickupAttemptStatus, uploadMyPickupProof, verifyMyPickupOtp, viewInternalPickupProof, viewMyPickupProof
} from "../controllers/pickup.controller.js";
import { attachUser, requireAuthenticated, requireRole } from "../middleware/auth.middleware.js";
import { pickupProofUpload } from "../middleware/pickupProofUpload.middleware.js";

export const pickupManagementRouter = Router();
pickupManagementRouter.use(attachUser, requireAuthenticated, requirePickupManager);
pickupManagementRouter.get("/", listInternalPickupRequests);
pickupManagementRouter.get("/available-drivers", listAvailablePickupDrivers);
pickupManagementRouter.get("/:pickupId", getInternalPickupRequest);
pickupManagementRouter.post("/:pickupId/confirm", confirmPickupRequest);
pickupManagementRouter.post("/:pickupId/assign", assignPickupRequestDriver);
pickupManagementRouter.post("/:pickupId/cancel", cancelInternalPickupRequest);
pickupManagementRouter.get("/:pickupId/proofs/:proofId", viewInternalPickupProof);
pickupManagementRouter.post("/:pickupId/otp-exception/review", reviewPickupRequestOtpException);

export const pickupDriverRouter = Router();
pickupDriverRouter.use(attachUser, requireRole("delivery"));
pickupDriverRouter.get("/attempts", listMyPickupAttempts);
pickupDriverRouter.get("/attempts/:attemptId", getMyPickupAttempt);
pickupDriverRouter.get("/attempts/:attemptId/proofs/:proofId", viewMyPickupProof);
pickupDriverRouter.post("/attempts/:attemptId/status", updateMyPickupAttemptStatus);
pickupDriverRouter.post("/attempts/:attemptId/otp/request", requestMyPickupOtp);
pickupDriverRouter.post("/attempts/:attemptId/otp/verify", verifyMyPickupOtp);
pickupDriverRouter.post("/attempts/:attemptId/otp/exception", requestMyPickupOtpException);
pickupDriverRouter.post("/attempts/:attemptId/scan", scanMyPickupParcel);
pickupDriverRouter.post("/attempts/:attemptId/exceptions", addMyPickupException);
pickupDriverRouter.post("/attempts/:attemptId/proofs/:proofType", pickupProofUpload, uploadMyPickupProof);
pickupDriverRouter.post("/attempts/:attemptId/complete", completeMyPickupAttempt);
