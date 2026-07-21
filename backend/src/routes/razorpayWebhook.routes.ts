import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/razorpayWebhook.controller.js";

export const razorpayWebhookRouter = Router();

razorpayWebhookRouter.post("/", handleRazorpayWebhook);
