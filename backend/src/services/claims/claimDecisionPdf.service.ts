import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { IClaim } from "../../models/claim.model.js";
import type { IClaimDecision } from "../../models/claimDecision.model.js";

/**
 * The decision letter.
 *
 * A client needs something they can file, print, or forward to their own insurer
 *- an email in an inbox is not that. The letter restates the decision, the
 * arithmetic behind it, and the right to appeal, so it stands on its own without
 * the portal.
 *
 * Generated on demand rather than stored: the decision it renders is immutable,
 * so the same revision always produces the same letter, and nothing has to be
 * kept in sync or purged separately.
 */

function money(minor: number) {
  return `INR ${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function date(value?: Date | null) {
  return value ? value.toLocaleDateString("en-GB").replaceAll("/", "-") : "Not applicable";
}

function addHeader(document: PDFKit.PDFDocument, claimNumber: string, issuedAt: Date) {
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");
  if (fs.existsSync(logoPath)) document.image(logoPath, 48, 38, { fit: [190, 58] });
  else document.fillColor("#173b72").font("Helvetica-Bold").fontSize(22).text("SWIFTLINE", 48, 45);

  document.fillColor("#111827").font("Helvetica-Bold").fontSize(16)
    .text("CLAIM DECISION", 330, 45, { width: 215, align: "right" });
  document.font("Helvetica").fontSize(9)
    .text(claimNumber, 330, 68, { width: 215, align: "right" })
    .text(date(issuedAt), 330, 83, { width: 215, align: "right" });

  document.moveTo(48, 110).lineTo(547, 110).strokeColor("#173b72").lineWidth(1.2).stroke();
}

/** Label/value rows, returning the y position after the block. */
function addFacts(document: PDFKit.PDFDocument, rows: Array<[string, string]>, top: number) {
  let y = top;
  for (const [label, value] of rows) {
    document.fillColor("#475569").font("Helvetica").fontSize(9).text(label, 48, y, { width: 200 });
    document.fillColor("#111827").font("Helvetica-Bold").fontSize(10)
      .text(value, 250, y - 1, { width: 297 });
    y += 20;
  }
  return y;
}

export function buildClaimDecisionPdf(input: {
  claim: IClaim;
  decision: IClaimDecision;
  companyName: string;
}): Promise<Buffer> {
  const { claim, decision } = input;

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];

    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    addHeader(document, claim.claimNumber ?? "Draft claim", decision.createdAt);

    document.fillColor("#475569").font("Helvetica-Bold").fontSize(9).text("ISSUED TO", 48, 130);
    document.fillColor("#111827").font("Helvetica").fontSize(11)
      .text(input.companyName || "Customer", 48, 148, { width: 300 });

    const outcomeLabel =
      decision.outcome === "FULLY_APPROVED"
        ? "Approved in full"
        : decision.outcome === "PARTIALLY_APPROVED"
          ? "Approved in part"
          : "Not approved";

    let y = addFacts(
      document,
      [
        ["Claim number", claim.claimNumber ?? "-"],
        ["Shipment", claim.shipmentSnapshot?.trackingNumber || "-"],
        ["Claim type", claim.category.replace(/_/g, " ").toLowerCase()],
        ["Date filed", date(claim.submittedAt)],
        ["Decision", outcomeLabel]
      ],
      190
    );

    document.moveTo(48, y + 4).lineTo(547, y + 4).strokeColor("#cbd5e1").lineWidth(0.8).stroke();

    y = addFacts(
      document,
      [
        ["Amount claimed", money(decision.requestedAmountMinor)],
        // Included even on a refusal: it is the figure most decisions turn on,
        // and its absence is the first thing a disputing client asks about.
        ["Declared value at booking", money(decision.declaredValueMinor)],
        [
          "Amount approved",
          decision.outcome === "REJECTED" ? "Nil" : money(decision.approvedAmountMinor)
        ]
      ],
      y + 20
    );

    document.moveTo(48, y + 4).lineTo(547, y + 4).strokeColor("#cbd5e1").lineWidth(0.8).stroke();

    document.fillColor("#475569").font("Helvetica-Bold").fontSize(9)
      .text("REASONS", 48, y + 22);
    document.fillColor("#111827").font("Helvetica").fontSize(10)
      .text(decision.customerExplanation, 48, y + 40, { width: 499, align: "left" });

    // Positioned after the explanation, whose height varies with its length.
    const afterReasons = document.y + 24;

    if (claim.deadlines?.appealDeadlineAt) {
      document.fillColor("#475569").font("Helvetica-Bold").fontSize(9)
        .text("YOUR RIGHT TO APPEAL", 48, afterReasons);
      document.fillColor("#111827").font("Helvetica").fontSize(10).text(
        `If you disagree with this decision you may appeal once, in writing through the Swiftline portal, up to ${date(claim.deadlines.appealDeadlineAt)}. An appeal must state your reasons or provide new evidence. After that date this decision is final.`,
        48,
        afterReasons + 18,
        { width: 499 }
      );
    }

    if (decision.outcome !== "REJECTED") {
      document.fillColor("#111827").font("Helvetica").fontSize(10).text(
        "To receive this settlement, accept it in the portal and confirm the bank account it should be paid into. Swiftline verifies those details before releasing payment.",
        48,
        document.y + 16,
        { width: 499 }
      );
    }

    document.fillColor("#64748b").font("Helvetica").fontSize(8).text(
      `Decision revision ${decision.revision}. This letter is generated from the Swiftline Portal and is valid without signature.`,
      48,
      780,
      { width: 499, align: "center" }
    );

    document.end();
  });
}
