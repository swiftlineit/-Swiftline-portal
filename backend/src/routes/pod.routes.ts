import { Router } from "express";
import { attachUser, requireAuthenticated, requireRole } from "../middleware/auth.middleware.js";
import { podEvidenceUpload } from "../middleware/podEvidenceUpload.middleware.js";
import {
  createDeliveryPartner, createPodAssignment, getManagedPodAssignment, getMyDelivery,
  listAvailableDeliveryPeople, listDeliveryPartners, listManagedPodAssignments, listMyDeliveries,
  listPodEligibleShipments, recordFailedDelivery, requestSignatureException, requirePodManager,
  reviewPod, reviewSignatureException, savePodDraft, submitPod, updateMyDeliveryStatus,
  uploadPodEvidence, viewPodEvidence, reassignPodDelivery, submitManagedPod
} from "../controllers/pod.controller.js";

export const podManagementRouter = Router();
podManagementRouter.use(attachUser, requireAuthenticated, requirePodManager);
podManagementRouter.get("/partners", listDeliveryPartners);
podManagementRouter.post("/partners", requireRole("admin", "operations"), createDeliveryPartner);
podManagementRouter.get("/eligible-shipments", listPodEligibleShipments);
podManagementRouter.get("/delivery-people", listAvailableDeliveryPeople);
podManagementRouter.get("/assignments", listManagedPodAssignments);
podManagementRouter.post("/assignments", createPodAssignment);
podManagementRouter.get("/assignments/:assignmentId", getManagedPodAssignment);
podManagementRouter.post("/assignments/:assignmentId/reassign", reassignPodDelivery);
podManagementRouter.post("/assignments/:assignmentId/evidence/:type", requireRole("admin", "operations"), podEvidenceUpload, uploadPodEvidence);
podManagementRouter.get("/assignments/:assignmentId/revisions/:revisionId/evidence/:evidenceId", viewPodEvidence);
podManagementRouter.post("/assignments/:assignmentId/signature-exception/review", reviewSignatureException);
podManagementRouter.post("/assignments/:assignmentId/review", reviewPod);
podManagementRouter.post("/assignments/:assignmentId/manual-submit", requireRole("admin", "operations"), submitManagedPod);

export const podDeliveryRouter = Router();
podDeliveryRouter.use(attachUser, requireRole("delivery"));
podDeliveryRouter.get("/assignments", listMyDeliveries);
podDeliveryRouter.get("/assignments/:assignmentId", getMyDelivery);
podDeliveryRouter.post("/assignments/:assignmentId/status", updateMyDeliveryStatus);
podDeliveryRouter.post("/assignments/:assignmentId/evidence/:type", podEvidenceUpload, uploadPodEvidence);
podDeliveryRouter.get("/assignments/:assignmentId/revisions/:revisionId/evidence/:evidenceId", viewPodEvidence);
podDeliveryRouter.put("/assignments/:assignmentId/draft", savePodDraft);
podDeliveryRouter.post("/assignments/:assignmentId/signature-exception", requestSignatureException);
podDeliveryRouter.post("/assignments/:assignmentId/failed-attempt", recordFailedDelivery);
podDeliveryRouter.post("/assignments/:assignmentId/submit", submitPod);
