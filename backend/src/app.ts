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

export const app = express();

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);

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
app.use("/api/v1/business-accounts", businessAccountRouter);
app.use("/api/v1/branches", branchRouter);

app.use(notFoundHandler);
app.use(errorHandler);
