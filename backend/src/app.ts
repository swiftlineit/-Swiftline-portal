import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import {
  errorHandler,
  notFoundHandler
} from "./middleware/error.handler.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { globalLimiter } from "./middleware/rateLimit.middleware.js";
import { businessAccountRouter } from "./routes/businessAccount.routes.js";
import { branchRouter } from "./routes/branch.routes.js";
import { addressRouter } from "./routes/address.routes.js";
import { clientRouter } from "./routes/client.routes.js";
import { countryRateCardRouter } from "./routes/countryRateCard.routes.js";
import { dpdConfigurationRouter } from "./routes/dpdConfiguration.routes.js";
import { dpdShipmentRouter } from "./routes/dpdShipment.routes.js";
import { invoiceTemplateRouter } from "./routes/invoiceTemplate.routes.js";
import { invoiceUploadRouter } from "./routes/invoiceUpload.routes.js";
import { shipmentDraftRouter } from "./routes/shipmentDraft.routes.js";
import { shipmentAmendmentRouter } from "./routes/shipmentAmendment.routes.js";
import { razorpayWebhookRouter } from "./routes/razorpayWebhook.routes.js";
import { taxInvoiceRouter } from "./routes/taxInvoice.routes.js";
import { creditAccountRouter } from "./routes/creditAccount.routes.js";
import { creditAgreementRouter } from "./routes/creditAgreement.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { shipmentCancellationRouter } from "./routes/shipmentCancellation.routes.js";
import { shipmentManifestRouter } from "./routes/shipmentManifest.routes.js";
import { shipmentRouter } from "./routes/shipment.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { shipmentQuoteRouter } from "./routes/shipmentQuote.routes.js";
import { supportTicketRouter } from "./routes/supportTicket.routes.js";
import { operationsManifestRouter } from "./routes/operationsManifest.routes.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());

const allowedCorsOrigins = new Set(
  [env.CLIENT_URL, ...(env.CORS_ORIGINS?.split(",") ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin)
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedCorsOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);

app.use("/api/v1/webhooks/razorpay", express.raw({ type: "application/json", limit: "2mb" }), razorpayWebhookRouter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());
app.use(globalLimiter);

if (env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.get("/", (_request, response) => {
  response.status(200).json({
    success: true,
    message: "Swiftline Portal API"
  });
});

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/profile", profileRouter);
app.use("/api/v1/business-accounts", businessAccountRouter);
app.use("/api/v1/branches", branchRouter);
app.use("/api/v1/addresses", addressRouter);
app.use("/api/v1/client", clientRouter);
app.use("/api/v1/country-rate-cards", countryRateCardRouter);
app.use("/api/v1/dpd-configurations", dpdConfigurationRouter);
app.use("/api/v1/dpd-shipments", dpdShipmentRouter);
app.use("/api/v1/invoice-templates", invoiceTemplateRouter);
app.use("/api/v1/invoice-uploads", invoiceUploadRouter);
app.use("/api/v1/shipment-drafts", shipmentDraftRouter);
app.use("/api/v1/shipment-amendments", shipmentAmendmentRouter);
app.use("/api/v1/shipment-cancellations", shipmentCancellationRouter);
app.use("/api/v1/shipment-manifests", shipmentManifestRouter);
app.use("/api/v1/shipments", shipmentRouter);
app.use("/api/v1/quote-requests", shipmentQuoteRouter);
app.use("/api/v1/support-tickets", supportTicketRouter);
app.use("/api/v1/operations-manifests", operationsManifestRouter);
app.use("/api/v1/tax-invoices", taxInvoiceRouter);
app.use("/api/v1/credit-accounts", creditAccountRouter);
app.use("/api/v1/credit-agreements", creditAgreementRouter);
app.use("/api/v1/notifications", notificationRouter);

app.use(notFoundHandler);
app.use(errorHandler);
