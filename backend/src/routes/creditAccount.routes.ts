import { Router } from "express";
import {
  activateAdminCreditAccount, approveAdminCreditAccount, closeAdminCreditAccount,
  getAdminCreditAccount, listAdminCreditAccounts, reactivateAdminCreditAccount,
  rejectAdminCreditAccount, suspendAdminCreditAccount
} from "../controllers/adminCredit.controller.js";
import {
  closeAdminBillingCycle,
  createAdminOfflinePayment,
  downloadAdminStatement,
  exportAdminLedger,
  getAdminLedger,
  getAdminStatement,
  handleCreditBillingError,
  listAdminPayments,
  listAdminStatements,
  verifyAdminOfflinePayment,
  writeOffAdminStatement
} from "../controllers/creditBilling.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const creditAccountRouter = Router();

creditAccountRouter.use(attachUser);
creditAccountRouter.use(requireRole("admin", "finance"));
creditAccountRouter.get("/", listAdminCreditAccounts);
creditAccountRouter.get("/:businessAccountId/statements", listAdminStatements);
creditAccountRouter.post("/:businessAccountId/close-cycle", closeAdminBillingCycle);
creditAccountRouter.get("/:businessAccountId/statements/:statementId", getAdminStatement);
creditAccountRouter.get("/:businessAccountId/statements/:statementId/pdf", downloadAdminStatement);
creditAccountRouter.get("/:businessAccountId/payments", listAdminPayments);
creditAccountRouter.post("/:businessAccountId/payments/offline", createAdminOfflinePayment);
creditAccountRouter.post("/:businessAccountId/payments/:paymentId/verify", verifyAdminOfflinePayment);
creditAccountRouter.get("/:businessAccountId/ledger", getAdminLedger);
creditAccountRouter.get("/:businessAccountId/ledger/export", exportAdminLedger);
creditAccountRouter.get("/:businessAccountId", getAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/approve", approveAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/activate", activateAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/reject", rejectAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/suspend", suspendAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/reactivate", reactivateAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/close", closeAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/statements/:statementId/write-off", writeOffAdminStatement);
creditAccountRouter.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
  try {
    handleCreditBillingError(error, response);
  } catch (unhandled) {
    next(unhandled);
  }
});
