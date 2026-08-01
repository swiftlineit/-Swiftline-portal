import { Router } from "express";
import { handleSesWebhook } from "../controllers/sesWebhook.controller.js";

const router = Router();

router.post("/", handleSesWebhook);

export { router as sesWebhookRouter };
