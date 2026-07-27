import { Router } from "express";
import {
  createClientShipmentAmendment,
  downloadClientShipmentInvoicePdf,
  createClientDpdLabel,
  createClientSwiftlineShipment,
  createClientShipmentLabelAccess,
  createClientManualShipmentDraft,
  createClientInvoiceUpload,
  deleteClientShipmentKycDocument,
  deleteClientShipmentParcelKycDocument,
  downloadClientDpdInvoiceTemplate,
  downloadClientShipmentKycDocument,
  downloadClientShipmentParcelKycDocument,
  uploadClientShipmentKycDocument,
  uploadClientShipmentParcelKycDocument,
  getClientDashboard,
  listClientShipments,
  getClientShipmentDetails,
  trackClientShipment,
  getClientShipmentInvoice,
  getClientShipmentDraft,
  previewClientShipmentAmendment,
  processClientInvoiceUpload,
  updateClientShipmentDraft
} from "../controllers/client.controller.js";
import {
  createClientPrepaidTopUp,
  getClientPrepaidAccount,
  getClientPrepaidTopUp,
  listClientPrepaidTopUps,
  listClientPrepaidTransactions,
  verifyClientPrepaidTopUp
} from "../controllers/prepaid.controller.js";
import {
  autocompleteAddress,
  autocompleteConsignorAddress,
  confirmValidatedAddress,
  getConsignorPlaceAddress,
  getPlaceAddress,
  validateAddress
} from "../controllers/address.controller.js";
import {
  createClientShipmentManifest,
  downloadClientShipmentManifest,
  getClientShipmentManifestContext
} from "../controllers/shipmentManifest.controller.js";
import { listCountryRateCards } from "../controllers/countryRateCard.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { invoiceUpload } from "../middleware/invoiceUpload.middleware.js";
import { shipmentKycUpload } from "../middleware/shipmentKycUpload.middleware.js";
import {
  acceptClientPaymentTerms, getClientCreditSummary, getClientPaymentTerms, requestClientCredit
} from "../controllers/clientCredit.controller.js";
import {
  getClientCreditAgreement,
  getClientCreditAgreementPdf,
  listClientCreditAgreements,
  signClientCreditAgreement
} from "../controllers/creditAgreement.controller.js";
import {
  closeClientBillingCycle,
  createClientOnlinePayment,
  downloadClientStatement,
  exportClientLedger,
  getClientLedger,
  getClientStatement,
  handleCreditBillingError,
  listClientPayments,
  listClientStatements,
  submitClientOfflinePayment,
  verifyClientOnlinePayment
} from "../controllers/creditBilling.controller.js";
import {
  getClientCancellationCreditNotePdf,
  getClientCancellationFeeInvoicePdf,
  getClientShipmentCancellation,
  requestClientShipmentCancellation
} from "../controllers/shipmentCancellation.controller.js";
import {
  convertClientShipmentQuote, createClientQuoteShipmentDraft, createClientShipmentQuote, estimateClientShipmentQuote,
  getClientQuoteContext, getClientShipmentQuote, listClientShipmentQuotes
} from "../controllers/shipmentQuote.controller.js";
import {
  createClientTicket, getClientTicket, listClientTickets, replyClientTicket
} from "../controllers/supportTicket.controller.js";

export const clientRouter = Router();

clientRouter.use(attachUser);
clientRouter.use(requireRole("client"));

clientRouter.get("/support-tickets", listClientTickets);
clientRouter.post("/support-tickets", createClientTicket);
clientRouter.get("/support-tickets/:ticketId", getClientTicket);
clientRouter.post("/support-tickets/:ticketId/replies", replyClientTicket);

clientRouter.get("/dashboard", getClientDashboard);
clientRouter.get("/quotes/context", getClientQuoteContext);
clientRouter.post("/quotes/estimate", estimateClientShipmentQuote);
clientRouter.post("/quotes/draft", createClientQuoteShipmentDraft);
clientRouter.get("/quotes", listClientShipmentQuotes);
clientRouter.post("/quotes", createClientShipmentQuote);
clientRouter.get("/quotes/:quoteId", getClientShipmentQuote);
clientRouter.post("/quotes/:quoteId/convert", convertClientShipmentQuote);
clientRouter.get("/credit", getClientCreditSummary);
clientRouter.post("/credit/request", requestClientCredit);
clientRouter.get("/credit/payment-terms", getClientPaymentTerms);
clientRouter.post("/credit/payment-terms/accept", acceptClientPaymentTerms);
clientRouter.get("/credit/statements", listClientStatements);
clientRouter.post("/credit/statements/close-cycle", closeClientBillingCycle);
clientRouter.get("/credit/statements/:statementId", getClientStatement);
clientRouter.get("/credit/statements/:statementId/pdf", downloadClientStatement);
clientRouter.post("/credit/payments/online", createClientOnlinePayment);
clientRouter.post("/credit/payments/online/verify", verifyClientOnlinePayment);
clientRouter.post("/credit/payments/offline", submitClientOfflinePayment);
clientRouter.get("/credit/payments", listClientPayments);
clientRouter.get("/credit/ledger", getClientLedger);
clientRouter.get("/credit/ledger/export", exportClientLedger);
clientRouter.get("/credit-agreements", listClientCreditAgreements);
clientRouter.get("/credit-agreements/:agreementId/pdf", getClientCreditAgreementPdf);
clientRouter.post("/credit-agreements/:agreementId/sign", signClientCreditAgreement);
clientRouter.get("/credit-agreements/:agreementId", getClientCreditAgreement);
clientRouter.get("/country-rate-cards", listCountryRateCards);
clientRouter.get("/prepaid-account", getClientPrepaidAccount);
clientRouter.get("/prepaid-transactions", listClientPrepaidTransactions);
clientRouter.post("/prepaid-topups", createClientPrepaidTopUp);
clientRouter.post("/prepaid-topups/:id/verify", verifyClientPrepaidTopUp);
clientRouter.get("/prepaid-topups/:id", getClientPrepaidTopUp);
clientRouter.get("/prepaid-topups", listClientPrepaidTopUps);
clientRouter.get("/dpd-labels/template", downloadClientDpdInvoiceTemplate);
clientRouter.post("/dpd-labels/invoice-uploads", invoiceUpload, createClientInvoiceUpload);
clientRouter.post("/dpd-labels/invoice-uploads/:id/process", processClientInvoiceUpload);
clientRouter.post("/dpd-labels/drafts/manual", createClientManualShipmentDraft);
clientRouter.get("/dpd-labels/drafts/:id", getClientShipmentDraft);
clientRouter.patch("/dpd-labels/drafts/:id", updateClientShipmentDraft);
clientRouter.post("/dpd-labels/drafts/:id/kyc-documents/:type", shipmentKycUpload, uploadClientShipmentKycDocument);
clientRouter.delete("/dpd-labels/drafts/:id/kyc-documents/:type", deleteClientShipmentKycDocument);
clientRouter.get("/dpd-labels/drafts/:id/kyc-documents/:type", downloadClientShipmentKycDocument);
clientRouter.post("/dpd-labels/drafts/:id/parcels/:sequence/kyc-documents/:type", shipmentKycUpload, uploadClientShipmentParcelKycDocument);
clientRouter.delete("/dpd-labels/drafts/:id/parcels/:sequence/kyc-documents/:type", deleteClientShipmentParcelKycDocument);
clientRouter.get("/dpd-labels/drafts/:id/parcels/:sequence/kyc-documents/:type", downloadClientShipmentParcelKycDocument);
clientRouter.post("/dpd-labels/drafts/:id/create-dpd-label", createClientDpdLabel);
clientRouter.post("/dpd-labels/drafts/:id/create-swiftline-shipment", createClientSwiftlineShipment);
clientRouter.get("/shipments", listClientShipments);
clientRouter.get("/tracking/:trackingNumber", trackClientShipment);
clientRouter.get("/shipments/:draftId/labels/:labelId/access", createClientShipmentLabelAccess);
clientRouter.get("/shipments/:id", getClientShipmentDetails);
clientRouter.get("/shipments/:draftId/manifests/context", getClientShipmentManifestContext);
clientRouter.post("/shipment-manifests", createClientShipmentManifest);
clientRouter.get("/shipment-manifests/:manifestId/download", downloadClientShipmentManifest);
clientRouter.get("/shipments/:draftId/cancellation", getClientShipmentCancellation);
clientRouter.post("/shipments/:draftId/cancellation", requestClientShipmentCancellation);
clientRouter.get("/shipment-cancellations/:id/credit-note/pdf", getClientCancellationCreditNotePdf);
clientRouter.get("/shipment-cancellations/:id/fee-invoice/pdf", getClientCancellationFeeInvoicePdf);
clientRouter.post("/shipments/:id/amendments/preview", previewClientShipmentAmendment);
clientRouter.post("/shipments/:id/amendments", createClientShipmentAmendment);
clientRouter.get("/shipments/:draftId/invoice", getClientShipmentInvoice);
clientRouter.get("/shipments/:draftId/invoice/pdf", downloadClientShipmentInvoicePdf);
clientRouter.post("/dpd-labels/addresses/autocomplete", autocompleteAddress);
clientRouter.post("/dpd-labels/addresses/consignor/autocomplete", autocompleteConsignorAddress);
clientRouter.get("/dpd-labels/addresses/consignor/places/:placeId", getConsignorPlaceAddress);
clientRouter.get("/dpd-labels/addresses/places/:placeId", getPlaceAddress);
clientRouter.post("/dpd-labels/addresses/validate", validateAddress);
clientRouter.post("/dpd-labels/addresses/confirm", confirmValidatedAddress);
clientRouter.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
  try {
    handleCreditBillingError(error, response);
  } catch (unhandled) {
    next(unhandled);
  }
});
