import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import { attachUser, requireAuthenticated } from "./middleware/auth.middleware.js";
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
import { addressLookupRouter } from "./routes/addressLookup.routes.js";
import { referenceRouter } from "./routes/reference.routes.js";
import { clientRouter } from "./routes/client.routes.js";
import { countryRateCardRouter } from "./routes/countryRateCard.routes.js";
import { publicRateCardRouter, rateCardShareRouter } from "./routes/rateCardShare.routes.js";
import { dpdConfigurationRouter } from "./routes/dpdConfiguration.routes.js";
import { dpdShipmentRouter } from "./routes/dpdShipment.routes.js";
import { invoiceTemplateRouter } from "./routes/invoiceTemplate.routes.js";
import { invoiceUploadRouter } from "./routes/invoiceUpload.routes.js";
import { shipmentDraftRouter } from "./routes/shipmentDraft.routes.js";
import { shipmentAmendmentRouter } from "./routes/shipmentAmendment.routes.js";
import { razorpayWebhookRouter } from "./routes/razorpayWebhook.routes.js";
import { sesWebhookRouter } from "./routes/sesWebhook.routes.js";
import { creditAccountRouter } from "./routes/creditAccount.routes.js";
import { creditAgreementRouter } from "./routes/creditAgreement.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { shipmentCancellationRouter } from "./routes/shipmentCancellation.routes.js";
import { counterSalesRouter } from "./routes/counterSales.routes.js";
import { shipmentManifestRouter } from "./routes/shipmentManifest.routes.js";
import { shipmentRouter } from "./routes/shipment.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { shipmentQuoteRouter } from "./routes/shipmentQuote.routes.js";
import { supportTicketRouter } from "./routes/supportTicket.routes.js";
import { operationsManifestRouter } from "./routes/operationsManifest.routes.js";
import { operationsAdvisoryRouter } from "./routes/operationsAdvisory.routes.js";
import { driverManagementRouter, driverPortalRouter } from "./routes/driver.routes.js";
import { pickupDriverRouter, pickupManagementRouter } from "./routes/pickup.routes.js";
import { podDeliveryRouter, podManagementRouter } from "./routes/pod.routes.js";

export const app = express();

app.disable("x-powered-by");

// One hop: nginx terminating TLS on the same instance. Without this every request
// carries the proxy's IP, so the rate limiters below collapse into a single shared
// bucket and five bad logins lock out every user at once. Raise to 2 if an ALB or
// CloudFront is ever put in front of nginx — setting it higher than the real hop
// count lets clients spoof X-Forwarded-For and walk past the limiters entirely.
app.set("trust proxy", 1);

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
// SNS posts its envelope as text/plain, so this must parse ahead of express.json.
app.use("/api/v1/webhooks/ses", express.text({ type: "*/*", limit: "1mb" }), sesWebhookRouter);
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
app.use("/api/v1/address-lookup", addressLookupRouter);
app.use("/api/v1/reference", referenceRouter);
app.use("/api/v1/client", clientRouter);
app.use("/api/v1/country-rate-cards", countryRateCardRouter);
app.use("/api/v1/rate-card-shares", rateCardShareRouter);
// Session-free by design: the link token in the query string is the credential.
app.use("/api/v1/public/rate-cards", publicRateCardRouter);
app.use("/api/v1/dpd-configurations", dpdConfigurationRouter);
app.use("/api/v1/dpd-shipments", dpdShipmentRouter);
app.use("/api/v1/invoice-templates", invoiceTemplateRouter);
app.use("/api/v1/invoice-uploads", invoiceUploadRouter);
app.use("/api/v1/shipment-drafts", shipmentDraftRouter);
app.use("/api/v1/shipment-amendments", shipmentAmendmentRouter);
app.use("/api/v1/shipment-cancellations", shipmentCancellationRouter);
app.use("/api/v1/counter-sales", counterSalesRouter);
app.use("/api/v1/shipment-manifests", shipmentManifestRouter);
app.use("/api/v1/shipments", shipmentRouter);
app.use("/api/v1/quote-requests", shipmentQuoteRouter);
app.use("/api/v1/support-tickets", supportTicketRouter);
app.use("/api/v1/operations-manifests", operationsManifestRouter);
app.use("/api/v1/operations-advisory", operationsAdvisoryRouter);
app.use("/api/v1/drivers", driverManagementRouter);
app.use("/api/v1/driver", driverPortalRouter);
app.use("/api/v1/pickups", pickupManagementRouter);
app.use("/api/v1/driver/pickups", pickupDriverRouter);
app.use("/api/v1/pod", podManagementRouter);
app.use("/api/v1/driver/deliveries", podDeliveryRouter);
app.use("/api/v1/credit-accounts", creditAccountRouter);
app.use("/api/v1/credit-agreements", creditAgreementRouter);
app.use("/api/v1/notifications", notificationRouter);

// attachUser only populates req.user when a valid token is present; it does not
// reject anonymous requests. Without an explicit gate every private upload
// (KYC documents, invoices, credit agreements) would be world-readable.
const privateUploadRoot = path.resolve(process.cwd(), "private_uploads");
app.use("/api/v1/files", attachUser, requireAuthenticated, express.static(privateUploadRoot));

app.use(notFoundHandler);
app.use(errorHandler);
