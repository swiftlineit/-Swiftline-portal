import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { supportTicketCategoryValues } from "../models/supportTicket.model.js";
import { SupportTicketError } from "../services/supportTicket.service.js";
import {
  deleteTicketDraft,
  getTicketDraft,
  listTicketDrafts,
  serializeTicketDraft,
  submitTicketDraft,
  upsertTicketDraft,
} from "../services/supportTicketDraft.service.js";
import { serializeSupportTicket } from "../services/supportTicket.service.js";

const upsertSchema = z.object({
  businessAccountId: z.string().trim().min(1),
  category: z.enum(supportTicketCategoryValues).optional(),
  subject: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  relatedShipmentDraftId: z.string().trim().nullable().optional(),
  version: z.number().int().min(1).optional(),
});

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

function draftId(request: Request) {
  const value = request.params.draftId;
  return Array.isArray(value) ? value[0] : value;
}

function handle(error: unknown, response: Response): Response {
  if (error instanceof SupportTicketError) return response.status(error.statusCode).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) {
    return response.status(400).json({ success: false, message: error.issues[0]?.message || "Correct the draft details and try again." });
  }
  throw error;
}

export async function listClientTicketDrafts(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const drafts = await listTicketDrafts(actor);
    return response.json({ success: true, drafts: drafts.map((d) => serializeTicketDraft(d as never)) });
  } catch (error) { return handle(error, response); }
}

export async function getClientTicketDraft(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const draft = await getTicketDraft(draftId(request) ?? "", actor);
    return response.json({ success: true, draft: serializeTicketDraft(draft) });
  } catch (error) { return handle(error, response); }
}

export async function putClientTicketDraft(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const input = upsertSchema.parse(request.body);
    const draft = await upsertTicketDraft(actor, draftId(request) ?? null, input);
    return response.json({ success: true, draft: serializeTicketDraft(draft) });
  } catch (error) { return handle(error, response); }
}

export async function postClientTicketDraft(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const input = upsertSchema.parse(request.body);
    const draft = await upsertTicketDraft(actor, null, input);
    return response.status(201).json({ success: true, draft: serializeTicketDraft(draft) });
  } catch (error) { return handle(error, response); }
}

export async function deleteClientTicketDraft(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    await deleteTicketDraft(draftId(request) ?? "", actor);
    return response.json({ success: true, message: "Draft deleted." });
  } catch (error) { return handle(error, response); }
}

export async function submitClientTicketDraft(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await submitTicketDraft(draftId(request) ?? "", actor);
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "CLIENT", true), message: "Ticket submitted." });
  } catch (error) { return handle(error, response); }
}
