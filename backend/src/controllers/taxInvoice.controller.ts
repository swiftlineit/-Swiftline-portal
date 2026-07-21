import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { TaxInvoice } from "../models/taxInvoice.model.js";
import { amountMinorToWords, computeTaxInvoiceAmounts, getNextTaxInvoiceNumber } from "../services/taxInvoice.service.js";

const partySchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  companyName: z.string().trim().max(160).optional().default(""),
  address: z.string().trim().max(1000).optional().default(""),
  email: z.string().trim().email().optional().or(z.literal("")).default(""),
  phone: z.string().trim().max(40).optional().default(""),
  gstinUin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN/UIN must contain 15 letters and numbers.").optional().or(z.literal("")).default(""),
  state: z.string().trim().max(100).optional().default(""),
  stateCode: z.string().trim().regex(/^\d{2}$/, "State code must contain 2 digits.").optional().or(z.literal("")).default("")
});

const itemSchema = z.object({
  description: z.string().trim().max(300).optional().default(""),
  hsCode: z.string().trim().max(40).optional().default(""),
  unitType: z.string().trim().max(30).optional().default("PCS"),
  quantity: z.coerce.number().int().nonnegative().optional().default(0),
  unitRateMinor: z.coerce.number().int().nonnegative().optional().default(0),
  amountMinor: z.coerce.number().int().nonnegative().optional().default(0)
});

const boxSchema = z.object({
  boxNumber: z.string().trim().max(30).optional().default(""),
  dimensions: z.object({
    length: z.coerce.number().nonnegative().nullable().optional().default(null),
    width: z.coerce.number().nonnegative().nullable().optional().default(null),
    height: z.coerce.number().nonnegative().nullable().optional().default(null),
    unit: z.string().trim().max(10).optional().default("cm")
  }).optional().default({ length: null, width: null, height: null, unit: "cm" }),
  actualWeight: z.coerce.number().nonnegative().nullable().optional().default(null),
  weightUnit: z.string().trim().max(10).optional().default("kg"),
  items: z.array(itemSchema).optional().default([])
});

const taxSummarySchema = z.object({
  hsnSac: z.string().trim().max(40).optional().default(""),
  gstType: z.enum(["CGST", "SGST", "IGST", "UTGST"]).optional().default("IGST"),
  taxableValueMinor: z.coerce.number().int().nonnegative().optional().default(0),
  gstRatePercent: z.coerce.number().nonnegative().optional().default(0),
  igstAmountMinor: z.coerce.number().int().nonnegative().optional().default(0),
  totalTaxAmountMinor: z.coerce.number().int().nonnegative().optional().default(0)
});

const taxInvoicePayloadSchema = z.object({
  invoiceNumber: z.string().trim().max(40).optional().default(""),
  invoiceDate: z.string().trim().optional().default(""),
  otherReference: z.string().trim().max(120).optional().default(""),
  paymentTerms: z.string().trim().max(160).optional().default(""),
  buyerOrderNumber: z.string().trim().max(120).optional().default(""),
  dispatchDocumentNumber: z.string().trim().max(120).optional().default(""),
  dispatchedThrough: z.string().trim().max(120).optional().default(""),
  termsOfDelivery: z.string().trim().max(500).optional().default(""),
  shipperIdType: z.string().trim().max(80).optional().default(""),
  shipperIdNumber: z.string().trim().max(120).optional().default(""),
  shipper: partySchema.optional().default({ name: "", companyName: "", address: "", email: "", phone: "", gstinUin: "", state: "", stateCode: "" }),
  consignee: partySchema.optional().default({ name: "", companyName: "", address: "", email: "", phone: "", gstinUin: "", state: "", stateCode: "" }),
  countryOfOrigin: z.string().trim().max(100).optional().default(""),
  destinationCountry: z.string().trim().max(100).optional().default(""),
  declarationNote: z.string().trim().max(1200).optional().default(""),
  currency: z.string().trim().toUpperCase().max(10).optional().default("INR"),
  boxes: z.array(boxSchema).optional().default([]),
  taxSummary: z.array(taxSummarySchema).optional().default([]),
  amountInWords: z.string().trim().max(500).optional().default(""),
  taxAmountInWords: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1200).optional().default("")
});

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function parseInvoiceDate(value: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

async function normalizePayload(data: z.infer<typeof taxInvoicePayloadSchema>, mode: "create" | "update") {
  const computed = computeTaxInvoiceAmounts(data.boxes, data.taxSummary);
  const invoiceNumber = mode === "create" && !data.invoiceNumber
    ? await getNextTaxInvoiceNumber()
    : data.invoiceNumber;

  return {
    invoiceNumber,
    invoiceDate: parseInvoiceDate(data.invoiceDate),
    otherReference: data.otherReference,
    paymentTerms: data.paymentTerms,
    buyerOrderNumber: data.buyerOrderNumber,
    dispatchDocumentNumber: data.dispatchDocumentNumber,
    dispatchedThrough: data.dispatchedThrough,
    termsOfDelivery: data.termsOfDelivery,
    shipperIdType: data.shipperIdType,
    shipperIdNumber: data.shipperIdNumber,
    shipper: data.shipper,
    consignee: data.consignee,
    countryOfOrigin: data.countryOfOrigin,
    destinationCountry: data.destinationCountry,
    declarationNote: data.declarationNote,
    currency: data.currency || "INR",
    boxes: computed.boxes,
    taxSummary: computed.taxSummary,
    subTotalMinor: computed.subTotalMinor,
    totalTaxAmountMinor: computed.totalTaxAmountMinor,
    totalAmountMinor: computed.totalAmountMinor,
    amountInWords: data.amountInWords || amountMinorToWords(computed.totalAmountMinor, data.currency || "INR"),
    taxAmountInWords: data.taxAmountInWords || (computed.totalTaxAmountMinor > 0 ? amountMinorToWords(computed.totalTaxAmountMinor, data.currency || "INR") : ""),
    notes: data.notes
  };
}

async function ensureUniqueInvoiceNumber(invoiceNumber: string, excludeId?: string) {
  const filter: Record<string, unknown> = { invoiceNumber };
  if (excludeId) filter._id = { $ne: new mongoose.Types.ObjectId(excludeId) };

  return !(await TaxInvoice.exists(filter));
}

export async function listTaxInvoices(request: Request, response: Response): Promise<Response> {
  const { search, status } = request.query;
  const filters: Record<string, unknown> = {};

  if (typeof status === "string" && status) filters.status = status;
  if (typeof search === "string" && search.trim()) {
    const pattern = new RegExp(search.trim(), "i");
    filters.$or = [
      { invoiceNumber: pattern },
      { "shipper.name": pattern },
      { "shipper.companyName": pattern },
      { "consignee.name": pattern },
      { "consignee.companyName": pattern }
    ];
  }

  const invoices = await TaxInvoice.find(filters).sort({ createdAt: -1 }).lean().exec();
  return response.status(200).json({ success: true, invoices });
}

export async function createTaxInvoice(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = taxInvoicePayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const payload = await normalizePayload(parsed.data, "create");
  if (!(await ensureUniqueInvoiceNumber(payload.invoiceNumber))) {
    return response.status(409).json({ success: false, message: "Invoice number already exists." });
  }

  const invoice = await TaxInvoice.create({
    ...payload,
    status: "DRAFT",
    createdBy: userId,
    updatedBy: userId
  });

  return response.status(201).json({ success: true, invoice });
}

export async function getTaxInvoice(request: Request, response: Response): Promise<Response> {
  const invoiceId = typeof request.params.invoiceId === "string" ? request.params.invoiceId : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    return response.status(404).json({ success: false, message: "Tax invoice not found." });
  }

  const invoice = await TaxInvoice.findById(invoiceId).lean().exec();
  if (!invoice) return response.status(404).json({ success: false, message: "Tax invoice not found." });

  return response.status(200).json({ success: true, invoice });
}

export async function updateTaxInvoice(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const invoiceId = typeof request.params.invoiceId === "string" ? request.params.invoiceId : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    return response.status(404).json({ success: false, message: "Tax invoice not found." });
  }

  const parsed = taxInvoicePayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const invoice = await TaxInvoice.findById(invoiceId).exec();
  if (!invoice) return response.status(404).json({ success: false, message: "Tax invoice not found." });
  if (invoice.status !== "DRAFT") {
    return response.status(409).json({ success: false, message: "Finalized invoices cannot be edited." });
  }

  const payload = await normalizePayload(parsed.data, "update");
  if (!payload.invoiceNumber) return response.status(400).json({ success: false, message: "Invoice number is required." });
  if (!(await ensureUniqueInvoiceNumber(payload.invoiceNumber, invoiceId))) {
    return response.status(409).json({ success: false, message: "Invoice number already exists." });
  }

  invoice.set({ ...payload, updatedBy: userId });
  await invoice.save();

  return response.status(200).json({ success: true, invoice });
}

export async function finalizeTaxInvoice(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const invoiceId = typeof request.params.invoiceId === "string" ? request.params.invoiceId : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    return response.status(404).json({ success: false, message: "Tax invoice not found." });
  }

  const invoice = await TaxInvoice.findById(invoiceId).exec();
  if (!invoice) return response.status(404).json({ success: false, message: "Tax invoice not found." });
  if (invoice.status !== "DRAFT") {
    return response.status(409).json({ success: false, message: "Invoice is already finalized." });
  }

  if (!invoice.consignee.name && !invoice.consignee.companyName) {
    return response.status(400).json({ success: false, message: "Consignee name or company name is required before finalizing." });
  }
  if (!invoice.boxes.length || invoice.totalAmountMinor <= 0) {
    return response.status(400).json({ success: false, message: "Add at least one billable item before finalizing." });
  }

  invoice.status = "FINALIZED";
  invoice.finalizedAt = new Date();
  invoice.updatedBy = userId;
  await invoice.save();

  return response.status(200).json({ success: true, invoice });
}

export async function deleteTaxInvoice(request: Request, response: Response): Promise<Response> {
  const invoiceId = typeof request.params.invoiceId === "string" ? request.params.invoiceId : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    return response.status(404).json({ success: false, message: "Tax invoice not found." });
  }

  const invoice = await TaxInvoice.findById(invoiceId).exec();
  if (!invoice) return response.status(404).json({ success: false, message: "Tax invoice not found." });
  if (invoice.status !== "DRAFT") {
    return response.status(409).json({ success: false, message: "Only draft invoices can be deleted." });
  }

  await invoice.deleteOne();

  return response.status(200).json({ success: true });
}
