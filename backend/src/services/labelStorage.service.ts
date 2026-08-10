import type { LabelFormat, LabelSize, LabelType } from "../models/labelDocument.model.js";
import { checksumOf, putObject, shipmentLabelKey } from "./storage/storage.service.js";

export interface StoredLabel {
  /** Storage service key. Never a filesystem path — see storage.service.ts. */
  storageKey: string;
  fileChecksum: string;
}

export async function saveLabelDocument(params: {
  shipmentDraftId: string;
  parcelNumber: string;
  labelBase64: string;
  format: LabelFormat;
  labelSize: LabelSize;
  labelType?: LabelType;
}): Promise<StoredLabel> {
  return saveLabelBuffer({
    ...params,
    buffer: Buffer.from(params.labelBase64, "base64")
  });
}

export async function saveLabelBuffer(params: {
  shipmentDraftId: string;
  parcelNumber: string;
  buffer: Buffer;
  format: LabelFormat;
  labelSize: LabelSize;
  labelType?: LabelType;
}): Promise<StoredLabel> {
  const extension = params.format === "PDF" ? "pdf" : "zpl";
  const labelType = params.labelType ?? "DPD";

  // Grouped under the draft rather than the booking so a shipment's label sits
  // beside its KYC documents under one prefix. The parcel number and label type
  // are metadata on the record, not part of the key: the filename is always a
  // server-generated UUID, which is what makes regenerating a label safe — it
  // writes a new object instead of overwriting the one already sent to a client.
  const storageKey = shipmentLabelKey(
    params.shipmentDraftId,
    `${labelType.toLowerCase()}-label.${extension}`
  );

  await putObject({
    key: storageKey,
    body: params.buffer,
    contentType: params.format === "PDF" ? "application/pdf" : "text/plain",
    originalName: `${labelType.toLowerCase()}-label-${params.parcelNumber}.${extension}`
  });

  return {
    storageKey,
    fileChecksum: checksumOf(params.buffer)
  };
}
