import { Router } from "express";
import mongoose from "mongoose";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.status(200).json({
    success: true,
    message: "Swiftline Portal API is operational",
    timestamp: new Date().toISOString(),
    services: {
      api: "connected",
      mongodb:
        mongoose.connection.readyState === 1
          ? "connected"
          : "disconnected",
    },
  });
});