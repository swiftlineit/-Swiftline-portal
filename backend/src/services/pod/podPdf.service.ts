/**
 * Proof of delivery as a PDF, one delivery per page.
 *
 * A merged document rather than a zip of original files: a POD is usually sent
 * on to somebody — a supplier, an insurer, a customer's own client — and one
 * attachment they can open is worth more than a folder they have to unpack.
 * The signature and photographs are placed inline for the same reason.
 *
 * Only files that are actually images are drawn. Evidence can be a PDF or
 * anything else the delivery app captured, and pdfkit cannot embed those; a
 * page that silently omitted them would be misleading, so they are listed by
 * name instead with a note that they are attached to the shipment.
 */
import PDFDocument from "pdfkit";
import { getObjectBuffer, StorageObjectNotFoundError } from "../storage/storage.service.js";
import type { PodCentreRow } from "./podCentre.service.js";

const BRAND = "#0D1282";
const INK = "#0F172A";
const MUTED = "#64748B";

function formatDate(value: Date | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(value);
}

/** pdfkit embeds PNG and JPEG only; anything else has to be named, not drawn. */
function isEmbeddableImage(mimeType: string) {
  return /^image\/(png|jpe?g)$/i.test(mimeType);
}

export async function buildPodPdf(pods: PodCentreRow[], accountLabel: string): Promise<Buffer> {
  // Images are fetched before drawing so one missing file cannot leave a
  // half-written page: a POD whose evidence has expired from storage still
  // produces its details page, with the gap stated.
  const images = new Map<string, Buffer>();
  await Promise.all(pods.flatMap((pod) => pod.evidence
    .filter((item) => isEmbeddableImage(item.mimeType) && item.storageKey)
    .map(async (item) => {
      try {
        images.set(item.id, await getObjectBuffer(item.storageKey));
      } catch (error) {
        /**
         * Any failure to read one file is reported on the page, never thrown.
         *
         * Deliberately broader than StorageObjectNotFoundError. Evidence
         * captured before storage keys replaced absolute paths has no key at
         * all, and that rejects with a validation error rather than a
         * not-found — which aborted the whole document on the first such file,
         * losing every other POD in the batch along with it.
         */
        console.error("POD evidence could not be read for the PDF.", {
          evidenceId: item.id,
          reason: error instanceof Error ? error.message : "Unknown error",
          expired: error instanceof StorageObjectNotFoundError
        });
      }
    })));

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const left = document.page.margins.left;
    const width = document.page.width - left - document.page.margins.right;

    pods.forEach((pod, index) => {
      if (index > 0) document.addPage();

      document.fillColor(BRAND).fontSize(16).font("Helvetica-Bold")
        .text("Proof of Delivery", left, document.y);
      document.fillColor(MUTED).fontSize(9).font("Helvetica")
        .text(accountLabel, { width });
      document.moveDown(0.8);

      const rows: Array<[string, string]> = [
        ["AWB", pod.awb || "Not assigned"],
        ["Carrier reference", pod.carrierReference || "Not assigned"],
        ["Consignee", pod.consignee || "Not recorded"],
        ["Destination", pod.destination || "Not recorded"],
        ["Parcels", pod.parcelNumbers.join(", ") || "Not recorded"],
        ["Received by", pod.recipientName || "Not recorded"],
        ["Relationship", pod.recipientRelationship || "Not recorded"],
        ["Delivered at", formatDate(pod.deliveredAt)]
      ];

      for (const [label, value] of rows) {
        const top = document.y;
        document.fillColor(MUTED).fontSize(8).font("Helvetica")
          .text(label.toUpperCase(), left, top, { width: 130 });
        document.fillColor(INK).fontSize(10).font("Helvetica")
          .text(value, left + 140, top, { width: width - 140 });
        document.y = Math.max(document.y, top + 16);
      }

      document.moveDown(0.6);
      document.moveTo(left, document.y).lineTo(left + width, document.y).strokeColor("#E2E8F0").stroke();
      document.moveDown(0.8);

      const drawable = pod.evidence.filter((item) => images.has(item.id));
      const others = pod.evidence.filter((item) => !images.has(item.id));

      if (!pod.evidence.length) {
        document.fillColor(MUTED).fontSize(9).text("No evidence was captured for this delivery.", left, document.y, { width });
      }

      for (const item of drawable) {
        // Kept within the page rather than scaled to fill it: a signature
        // blown up to full width is harder to read, not easier.
        const maxHeight = 220;
        if (document.y + maxHeight > document.page.height - document.page.margins.bottom) document.addPage();
        document.fillColor(MUTED).fontSize(8)
          .text(`${item.type.replace(/_/g, " ")} · ${formatDate(item.capturedAt)}`, left, document.y, { width });
        document.moveDown(0.2);
        try {
          document.image(images.get(item.id)!, left, document.y, { fit: [width, maxHeight] });
          document.y += maxHeight + 12;
        } catch {
          // A corrupt or unsupported image must not abort the document.
          document.fillColor(MUTED).fontSize(9)
            .text(`${item.originalName} could not be rendered.`, left, document.y, { width });
          document.moveDown(0.6);
        }
      }

      if (others.length) {
        // Named rather than omitted: a page that quietly dropped evidence
        // would understate what Swiftline holds for this delivery.
        document.fillColor(MUTED).fontSize(9).text(
          `Additional evidence held against this shipment, not shown here: ${others.map((item) => item.originalName).join(", ")}`,
          left,
          document.y,
          { width }
        );
      }
    });

    const range = document.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      document.switchToPage(page);
      // The margin is dropped for the stamp because pdfkit starts a new page
      // for anything drawn past it, which would append a blank page per pass.
      const bottom = document.page.margins.bottom;
      document.page.margins.bottom = 0;
      document.fillColor("#94A3B8").fontSize(7).font("Helvetica").text(
        `Swiftline · proof of delivery · page ${page - range.start + 1} of ${range.count}`,
        left,
        document.page.height - bottom + 8,
        { width, align: "right", lineBreak: false }
      );
      document.page.margins.bottom = bottom;
    }

    document.end();
  });
}
