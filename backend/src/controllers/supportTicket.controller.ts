import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  supportTicketCategoryValues, supportTicketPriorityValues, supportTicketStatusValues,
  type SupportTicketCategory, type SupportTicketPriority, type SupportTicketStatus
} from "../models/supportTicket.model.js";
import {
  SupportTicketError, addSupportTicketReply, createClientSupportTicket, getSupportTicket,
  listActiveSupportAdmins, listAdminSupportTickets, listClientSupportTickets,
  serializeSupportTicket, updateSupportTicketByAdmin
} from "../services/supportTicket.service.js";

const createSchema = z.object({
  businessAccountId: z.string().trim().min(1, "Select a business account."),
  category: z.enum(supportTicketCategoryValues),
  subject: z.string().trim().min(5, "Subject must contain at least 5 characters.").max(120),
  description: z.string().trim().min(10, "Description must contain at least 10 characters.").max(2000),
  relatedShipmentDraftId: z.string().trim().nullable().optional()
});

const replySchema = z.object({
  message: z.string().trim().min(1, "Enter a reply before sending.").max(2000),
  internal: z.boolean().optional().default(false)
});

const updateSchema = z.object({
  status: z.enum(supportTicketStatusValues).optional(),
  priority: z.enum(supportTicketPriorityValues).optional(),
  assignedTo: z.string().trim().nullable().optional(),
  note: z.string().trim().max(500).optional().default("")
}).refine((input) => input.status !== undefined || input.priority !== undefined || input.assignedTo !== undefined, {
  message: "Choose a ticket field to update."
});

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

function ticketId(request: Request) {
  const value = request.params.ticketId;
  return Array.isArray(value) ? value[0] : value;
}

function filters(request: Request) {
  const status = typeof request.query.status === "string" && supportTicketStatusValues.includes(request.query.status as SupportTicketStatus)
    ? request.query.status as SupportTicketStatus : undefined;
  const priority = typeof request.query.priority === "string" && supportTicketPriorityValues.includes(request.query.priority as SupportTicketPriority)
    ? request.query.priority as SupportTicketPriority : undefined;
  const category = typeof request.query.category === "string" && supportTicketCategoryValues.includes(request.query.category as SupportTicketCategory)
    ? request.query.category as SupportTicketCategory : undefined;
  return {
    page: Math.max(1, Number(request.query.page) || 1),
    limit: Math.min(50, Math.max(1, Number(request.query.limit) || 20)),
    status, priority, category,
    search: typeof request.query.search === "string" ? request.query.search.trim().slice(0, 120) : undefined,
    branchId: typeof request.query.branchId === "string" ? request.query.branchId.trim() : undefined
  };
}

function handle(error: unknown, response: Response): Response {
  if (error instanceof SupportTicketError) return response.status(error.statusCode).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) {
    return response.status(400).json({
      success: false, message: error.issues[0]?.message || "Correct the ticket details and try again.",
      errors: error.flatten().fieldErrors
    });
  }
  throw error;
}

export async function createClientTicket(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await createClientSupportTicket(actor, createSchema.parse(request.body));
    return response.status(201).json({ success: true, ticket: await serializeSupportTicket(ticket, "CLIENT", true) });
  } catch (error) { return handle(error, response); }
}

export async function listClientTickets(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const result = await listClientSupportTickets(actor, filters(request));
    return response.json({
      success: true, tickets: result.tickets,
      pagination: { ...filters(request), total: result.total, totalPages: Math.max(1, Math.ceil(result.total / filters(request).limit)) }
    });
  } catch (error) { return handle(error, response); }
}

export async function getClientTicket(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await getSupportTicket(ticketId(request) ?? "", "CLIENT", actor);
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "CLIENT", true) });
  } catch (error) { return handle(error, response); }
}

export async function replyClientTicket(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await getSupportTicket(ticketId(request) ?? "", "CLIENT", actor);
    const input = replySchema.parse(request.body);
    await addSupportTicketReply({ ticket, userId: actor, audience: "CLIENT", message: input.message });
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "CLIENT", true), message: "Reply sent to Swiftline support." });
  } catch (error) { return handle(error, response); }
}

export async function listAdminTickets(request: Request, response: Response) {
  try {
    const parsed = filters(request);
    const result = await listAdminSupportTickets(parsed);
    return response.json({
      success: true, tickets: result.tickets,
      pagination: { page: parsed.page, limit: parsed.limit, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / parsed.limit)) }
    });
  } catch (error) { return handle(error, response); }
}

export async function getAdminTicket(request: Request, response: Response) {
  try {
    const ticket = await getSupportTicket(ticketId(request) ?? "", "ADMIN");
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "ADMIN", true) });
  } catch (error) { return handle(error, response); }
}

export async function replyAdminTicket(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await getSupportTicket(ticketId(request) ?? "", "ADMIN");
    const input = replySchema.parse(request.body);
    await addSupportTicketReply({ ticket, userId: actor, audience: "ADMIN", message: input.message, internal: input.internal });
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "ADMIN", true), message: input.internal ? "Internal note added." : "Reply sent to the customer." });
  } catch (error) { return handle(error, response); }
}

export async function updateAdminTicket(request: Request, response: Response) {
  try {
    const actor = userId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Please sign in again." });
    const ticket = await getSupportTicket(ticketId(request) ?? "", "ADMIN");
    await updateSupportTicketByAdmin({ ticket, userId: actor, ...updateSchema.parse(request.body) });
    return response.json({ success: true, ticket: await serializeSupportTicket(ticket, "ADMIN", true), message: "Ticket updated." });
  } catch (error) { return handle(error, response); }
}

export async function getSupportTicketContext(_request: Request, response: Response) {
  const admins = await listActiveSupportAdmins();
  return response.json({
    success: true,
    admins: admins.map((admin) => ({ id: String(admin._id), name: admin.name || admin.email, email: admin.email }))
  });
}
