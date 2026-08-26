import express from "express";
import { Router } from "express";
import {
  deleteClientTicketDraft,
  getClientTicketDraft,
  listClientTicketDrafts,
  postClientTicketDraft,
  putClientTicketDraft,
  submitClientTicketDraft,
} from "../controllers/supportTicketDraft.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const supportTicketDraftRouter = express.Router();

supportTicketDraftRouter.use(attachUser);
supportTicketDraftRouter.use(requireRole("client"));

supportTicketDraftRouter.get("/", listClientTicketDrafts);
supportTicketDraftRouter.post("/", postClientTicketDraft);
supportTicketDraftRouter.get("/:draftId", getClientTicketDraft);
supportTicketDraftRouter.put("/:draftId", putClientTicketDraft);
supportTicketDraftRouter.delete("/:draftId", deleteClientTicketDraft);
supportTicketDraftRouter.post("/:draftId/submit", submitClientTicketDraft);
