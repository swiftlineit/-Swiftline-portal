import fs from "fs/promises";
import { env } from "../../config/env.js";
import { LabelDocument } from "../../models/labelDocument.model.js";
import { ShipmentInvoice } from "../../models/shipmentInvoice.model.js";
import { ShipmentManifest } from "../../models/shipmentManifest.model.js";
import type { EmailAttachmentKind, IEmailAttachmentRef } from "../../models/emailOutbox.model.js";
import { serializeShipmentInvoice } from "../shipmentInvoice.service.js";
import { createShipmentInvoicePdf } from "../shipmentInvoicePdf.service.js";
import { buildShipmentManifestPdf } from "../shipmentManifestPdf.service.js";
import type { OutboundAttachment } from "./transport.js";

export type ResolvedAttachment = OutboundAttachment & { kind: EmailAttachmentKind };

export type AttachmentResolution = {
  attachments: ResolvedAttachment[];
  /** True when something was requested but could not be included. */
  dropped: boolean;
  droppedReason: string;
};

function safeFilename(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

/**
 * pdfkit streams rather than returning bytes, so the document has to be drained
 * before it can become a MIME part.
 */
function bufferPdfDocument(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.end();
  });
}

async function resolveShipmentInvoicePdf(ref: IEmailAttachmentRef): Promise<ResolvedAttachment | null> {
  const invoice = await ShipmentInvoice.findById(ref.refId).exec();
  if (!invoice) return null;

  const revision = ref.revision ?? invoice.revision;
  const serialized = serializeShipmentInvoice(invoice, revision);
  const content = await bufferPdfDocument(createShipmentInvoicePdf(serialized));

  return {
    kind: "SHIPMENT_INVOICE_PDF",
    filename: safeFilename(ref.filename || `${invoice.invoiceNumber}-Invoice-${revision}.pdf`),
    content,
    contentType: "application/pdf"
  };
}

async function resolveLabelDocument(ref: IEmailAttachmentRef): Promise<ResolvedAttachment | null> {
  const label = await LabelDocument.findById(ref.refId).lean().exec();
  if (!label) return null;

  // Labels live on disk. A missing file must not fail the whole email — the
  // invoice is the part the client actually needs for accounting.
  const content = await fs.readFile(label.storagePath).catch(() => null);
  if (!content) {
    console.warn("Label file missing for email attachment.", { labelId: String(ref.refId), storagePath: label.storagePath });
    return null;
  }

  const extension = label.format.toLowerCase();
  return {
    kind: "LABEL_DOCUMENT",
    filename: safeFilename(ref.filename || `${label.labelType.toLowerCase()}-label-${label.parcelNumber}.${extension}`),
    content,
    contentType: label.format === "PDF" ? "application/pdf" : "text/plain"
  };
}

async function resolveShipmentManifestPdf(ref: IEmailAttachmentRef): Promise<ResolvedAttachment | null> {
  const manifest = await ShipmentManifest.findById(ref.refId).exec();
  if (!manifest) return null;

  return {
    kind: "SHIPMENT_MANIFEST_PDF",
    filename: safeFilename(ref.filename || `MANIFEST-${manifest.manifestNumber}.pdf`),
    content: await buildShipmentManifestPdf(manifest),
    contentType: "application/pdf"
  };
}

const resolvers: Partial<Record<EmailAttachmentKind, (ref: IEmailAttachmentRef) => Promise<ResolvedAttachment | null>>> = {
  SHIPMENT_INVOICE_PDF: resolveShipmentInvoicePdf,
  LABEL_DOCUMENT: resolveLabelDocument,
  SHIPMENT_MANIFEST_PDF: resolveShipmentManifestPdf
};

/**
 * Resolves stored references into MIME parts, newest-value-first and within the
 * size budget. Attachments are ordered by the caller, so when the budget runs
 * out the trailing items are dropped — callers list the invoice before the
 * labels for exactly this reason.
 */
export async function resolveAttachments(refs: IEmailAttachmentRef[]): Promise<AttachmentResolution> {
  if (!refs.length) return { attachments: [], dropped: false, droppedReason: "" };

  const attachments: ResolvedAttachment[] = [];
  let totalBytes = 0;
  let dropped = false;
  let droppedReason = "";

  for (const ref of refs) {
    const resolver = resolvers[ref.kind];
    if (!resolver) {
      dropped = true;
      droppedReason = `No resolver registered for ${ref.kind}.`;
      console.warn("Unsupported email attachment kind requested.", { kind: ref.kind, refId: String(ref.refId) });
      continue;
    }

    const resolved = await resolver(ref).catch((error: unknown) => {
      console.error("Email attachment could not be built.", {
        kind: ref.kind,
        refId: String(ref.refId),
        message: error instanceof Error ? error.message : "Unknown error"
      });
      return null;
    });

    if (!resolved) {
      dropped = true;
      droppedReason = droppedReason || `${ref.kind} could not be resolved.`;
      continue;
    }

    if (totalBytes + resolved.content.length > env.EMAIL_MAX_ATTACHMENT_BYTES) {
      dropped = true;
      droppedReason = "Attachment size budget reached; remaining documents are available in the portal.";
      break;
    }

    totalBytes += resolved.content.length;
    attachments.push(resolved);
  }

  return { attachments, dropped, droppedReason };
}
