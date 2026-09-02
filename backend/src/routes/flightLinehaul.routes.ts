import { Router } from "express";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import * as controller from "../controllers/flightLinehaul.controller.js";
import { flightDocumentUpload } from "../middleware/flightDocumentUpload.middleware.js";
import { requireFlightBranch, requireRequestedFlightBranch } from "../middleware/flightLinehaulBranchAccess.middleware.js";

export const flightLinehaulRouter = Router();

flightLinehaulRouter.use(attachUser, requireRole("admin", "operations"));

// Dashboard & list
flightLinehaulRouter.get("/summary", controller.getFlightSummary);
flightLinehaulRouter.get("/exceptions", controller.listAllExceptions);
flightLinehaulRouter.get("/", controller.listFlights);
flightLinehaulRouter.post("/", requireRequestedFlightBranch, controller.createFlight);
flightLinehaulRouter.get("/eligible-shipments", controller.searchEligibleShipments);

// Flight scoped
flightLinehaulRouter.get("/:flightId", requireFlightBranch, controller.getFlight);
flightLinehaulRouter.patch("/:flightId", requireFlightBranch, controller.updateFlight);
flightLinehaulRouter.post("/:flightId/status", requireFlightBranch, controller.transitionStatus);
flightLinehaulRouter.post("/:flightId/cancel", requireFlightBranch, controller.cancelFlight);

// Shipments allocations
flightLinehaulRouter.get("/:flightId/eligible-shipments", requireFlightBranch, controller.searchEligibleShipments);
flightLinehaulRouter.post("/:flightId/shipments/allocate", requireFlightBranch, controller.allocateShipments);
flightLinehaulRouter.delete("/:flightId/shipments/:allocationId", requireFlightBranch, controller.removeAllocation);
flightLinehaulRouter.post("/:flightId/shipments/:allocationId/move", requireFlightBranch, controller.moveAllocation);

// Manifests
flightLinehaulRouter.get("/:flightId/manifests/options", requireFlightBranch, controller.listAttachableManifests);
flightLinehaulRouter.post("/:flightId/manifests/attach", requireFlightBranch, controller.attachManifest);
flightLinehaulRouter.delete("/:flightId/manifests/:manifestId", requireFlightBranch, controller.detachManifest);

// Connection & offload & handover
flightLinehaulRouter.patch("/:flightId/connection", requireFlightBranch, controller.updateConnection);
flightLinehaulRouter.post("/:flightId/offloads", requireFlightBranch, controller.createOffload);
flightLinehaulRouter.patch("/:flightId/handover", requireFlightBranch, controller.updateHandover);

// Documents
flightLinehaulRouter.get("/:flightId/documents", requireFlightBranch, controller.listDocuments);
flightLinehaulRouter.post("/:flightId/documents", requireFlightBranch, flightDocumentUpload.single("file"), controller.uploadDocument);
flightLinehaulRouter.get("/:flightId/documents/:documentId/download", requireFlightBranch, controller.downloadDocument);
flightLinehaulRouter.delete("/:flightId/documents/:documentId", requireFlightBranch, controller.deleteDocument);

// Exceptions - flight scoped and global
flightLinehaulRouter.get("/:flightId/exceptions", requireFlightBranch, controller.listExceptions);
flightLinehaulRouter.post("/exceptions/:exceptionId/acknowledge", controller.acknowledgeException);
flightLinehaulRouter.patch("/exceptions/:exceptionId", controller.updateException);
flightLinehaulRouter.post("/exceptions/:exceptionId/resolve", controller.resolveException);
