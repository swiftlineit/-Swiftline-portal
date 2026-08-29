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
// Operations reads credit records- statements, payments, and the ledger- to
// answer client questions. Moving money or changing a credit account's standing
// stays with finance, so every write below re-checks with the narrower guard.
creditAccountRouter.use(requireRole("admin", "finance", "operations"));

const requireFinance = requireRole("admin", "finance");
const requireAdmin = requireRole("admin");

creditAccountRouter.get("/", listAdminCreditAccounts);
creditAccountRouter.get("/:businessAccountId/statements", listAdminStatements);
creditAccountRouter.post("/:businessAccountId/close-cycle", requireFinance, closeAdminBillingCycle);
creditAccountRouter.get("/:businessAccountId/statements/:statementId", getAdminStatement);
creditAccountRouter.get("/:businessAccountId/statements/:statementId/pdf", downloadAdminStatement);
creditAccountRouter.get("/:businessAccountId/payments", listAdminPayments);
creditAccountRouter.post("/:businessAccountId/payments/offline", requireFinance, createAdminOfflinePayment);
creditAccountRouter.post("/:businessAccountId/payments/:paymentId/verify", requireFinance, verifyAdminOfflinePayment);
creditAccountRouter.get("/:businessAccountId/ledger", getAdminLedger);
creditAccountRouter.get("/:businessAccountId/ledger/export", exportAdminLedger);
creditAccountRouter.get("/:businessAccountId", getAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/approve", requireFinance, approveAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/activate", requireAdmin, activateAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/reject", requireFinance, rejectAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/suspend", requireFinance, suspendAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/reactivate", requireFinance, reactivateAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/close", requireFinance, closeAdminCreditAccount);
creditAccountRouter.post("/:businessAccountId/statements/:statementId/write-off", requireFinance, writeOffAdminStatement);
creditAccountRouter.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
  try {
    handleCreditBillingError(error, response);
  } catch (unhandled) {
    next(unhandled);
  }
});
