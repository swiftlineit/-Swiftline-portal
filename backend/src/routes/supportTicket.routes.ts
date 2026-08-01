import { Router } from "express";
import {
  getAdminTicket, getSupportTicketContext, listAdminTickets, replyAdminTicket, updateAdminTicket
} from "../controllers/supportTicket.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const supportTicketRouter = Router();
supportTicketRouter.use(attachUser);
supportTicketRouter.use(requireRole("admin", "operations"));
supportTicketRouter.get("/context", getSupportTicketContext);
supportTicketRouter.get("/", listAdminTickets);
supportTicketRouter.get("/:ticketId", getAdminTicket);
supportTicketRouter.post("/:ticketId/replies", replyAdminTicket);
supportTicketRouter.patch("/:ticketId", updateAdminTicket);
