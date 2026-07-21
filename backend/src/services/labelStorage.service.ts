import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { LabelFormat, LabelSize, LabelType } from "../models/labelDocument.model.js";

const privateLabelRoot = path.resolve(process.cwd(), "private_uploads", "labels");

fs.mkdirSync(privateLabelRoot, { recursive: true });

export interface StoredLabel {
  storagePath: string;
  fileChecksum: string;
}

export function saveLabelDocument(params: {
  dpdShipmentId: string;
  parcelNumber: string;
  labelBase64: string;
  format: LabelFormat;
  labelSize: LabelSize;
  labelType?: LabelType;
}): StoredLabel {
  return saveLabelBuffer({
    ...params,
    buffer: Buffer.from(params.labelBase64, "base64")
  });
}

export function saveLabelBuffer(params: {
  dpdShipmentId: string;
  parcelNumber: string;
  buffer: Buffer;
  format: LabelFormat;
  labelSize: LabelSize;
  labelType?: LabelType;
}): StoredLabel {
  const extension = params.format === "PDF" ? "pdf" : "zpl";
  const safeParcelNumber = params.parcelNumber.replace(/[^A-Za-z0-9_-]/g, "");
  const labelType = params.labelType ?? "DPD";
  const filename = `${params.dpdShipmentId}-${labelType.toLowerCase()}-${safeParcelNumber}-${Date.now()}.${extension}`;
  const storagePath = path.join(privateLabelRoot, filename);
  const fileChecksum = crypto.createHash("sha256").update(params.buffer).digest("hex");

  fs.writeFileSync(storagePath, params.buffer);

  return {
    storagePath,
    fileChecksum
  };
}
