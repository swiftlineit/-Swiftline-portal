"use client";

import { useMemo, useState } from "react";
import {
  DocumentInput,
  MultiSearchableSelect,
  type ExistingDocuments
} from "@/components/business-accounts/FormFieldControls";
import { BusinessAccountFiles, DocumentType } from "@/lib/businessAccounts";

const optionalDocumentOptions: { value: DocumentType; label: string }[] = [
  { value: "adCertificate", label: "AD Certificate" },
  { value: "msmeCertificate", label: "MSME Certificate" },
  { value: "tanCertificate", label: "TAN Certificate" },
  { value: "gstCertificate", label: "GST Certificate" },
  { value: "iecCertificate", label: "IEC Certificate" },
  { value: "otherCertificate", label: "Other Certificate" }
];

// Document step UI for uploading required KYC files.
export function DocumentsStep({
  documentFields,
  existingDocuments,
  files,
  documentErrors,
  onDocumentChange
}: {
  documentFields: { type: DocumentType; required: boolean; helper: string }[];
  existingDocuments: ExistingDocuments;
  files: BusinessAccountFiles;
  documentErrors: Partial<Record<DocumentType, string>>;
  onDocumentChange: (type: DocumentType, file: File | null) => void;
}) {
  const [selectedOptionalDocuments, setSelectedOptionalDocuments] = useState<DocumentType[]>(() =>
    optionalDocumentOptions
      .filter((option) => Boolean(files[option.value] || existingDocuments[option.value]))
      .map((option) => option.value)
  );
  const requiredFields = documentFields.filter((field) => field.required);
  const optionalFields = useMemo(
    () => selectedOptionalDocuments
      .map((type) => documentFields.find((field) => field.type === type))
      .filter((field): field is { type: DocumentType; required: boolean; helper: string } => Boolean(field)),
    [documentFields, selectedOptionalDocuments]
  );

  return (
    <div className="grid gap-4">
      <div className="border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm leading-6 text-slate-800">
        Upload Aadhaar Card and PAN Card to submit this account request. Additional documents may be needed later to complete KYC verification. You can add supporting certificates now or provide them when the KYC reviewer asks for them.
      </div>

      {requiredFields.map((field) => (
        <DocumentInput
          key={field.type}
          type={field.type}
          required={field.required}
          helper={field.helper}
          existingFileName={existingDocuments[field.type]?.originalName}
          file={files[field.type] ?? null}
          error={documentErrors[field.type]}
          onChange={(file) => onDocumentChange(field.type, file)}
        />
      ))}

      <div className="grid gap-4 border border-slate-200 p-4">
        <MultiSearchableSelect
          label="Other Documents"
          values={selectedOptionalDocuments}
          onChange={(values) => setSelectedOptionalDocuments(values as DocumentType[])}
          options={optionalDocumentOptions}
          searchable={false}
        />

        {optionalFields.length ? optionalFields.map((optionalField) => (
          <DocumentInput
            key={optionalField.type}
            type={optionalField.type}
            required={false}
            helper={optionalField.helper}
            existingFileName={existingDocuments[optionalField.type]?.originalName}
            file={files[optionalField.type] ?? null}
            error={documentErrors[optionalField.type]}
            onChange={(file) => onDocumentChange(optionalField.type, file)}
          />
        )) : (
          <p className="text-sm font-medium text-slate-500">Select one or more optional documents to upload.</p>
        )}
      </div>
    </div>
  );
}
