import mongoose from "mongoose";

export type TaxInvoiceStatus = "DRAFT" | "FINALIZED";

export interface ITaxInvoiceParty {
  name: string;
  companyName: string;
  address: string;
  email: string;
  phone: string;
  gstinUin: string;
  state: string;
  stateCode: string;
}

export interface ITaxInvoiceItem {
  description: string;
  hsCode: string;
  unitType: string;
  quantity: number;
  unitRateMinor: number;
  amountMinor: number;
}

export interface ITaxInvoiceBox {
  boxNumber: string;
  dimensions: {
    length: number | null;
    width: number | null;
    height: number | null;
    unit: string;
  };
  actualWeight: number | null;
  weightUnit: string;
  items: ITaxInvoiceItem[];
}

export interface ITaxInvoiceTaxSummary {
  hsnSac: string;
  gstType: "CGST" | "SGST" | "IGST" | "UTGST";
  taxableValueMinor: number;
  gstRatePercent: number;
  igstAmountMinor: number;
  totalTaxAmountMinor: number;
}

export interface ITaxInvoice extends mongoose.Document {
  invoiceNumber: string;
  invoiceDate: Date;
  otherReference: string;
  paymentTerms: string;
  buyerOrderNumber: string;
  dispatchDocumentNumber: string;
  dispatchedThrough: string;
  termsOfDelivery: string;
  shipperIdType: string;
  shipperIdNumber: string;
  shipper: ITaxInvoiceParty;
  consignee: ITaxInvoiceParty;
  countryOfOrigin: string;
  destinationCountry: string;
  declarationNote: string;
  currency: string;
  boxes: ITaxInvoiceBox[];
  taxSummary: ITaxInvoiceTaxSummary[];
  subTotalMinor: number;
  totalTaxAmountMinor: number;
  totalAmountMinor: number;
  amountInWords: string;
  taxAmountInWords: string;
  notes: string;
  status: TaxInvoiceStatus;
  finalizedAt?: Date | null;
  createdBy?: mongoose.Types.ObjectId | null;
  updatedBy?: mongoose.Types.ObjectId | null;
}

const partySchema = new mongoose.Schema<ITaxInvoiceParty>(
  {
    name: { type: String, trim: true, default: "" },
    companyName: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    email: { type: String, lowercase: true, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    gstinUin: { type: String, uppercase: true, trim: true, default: "", maxlength: 15 },
    state: { type: String, trim: true, default: "", maxlength: 100 },
    stateCode: { type: String, trim: true, default: "", maxlength: 2 }
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema<ITaxInvoiceItem>(
  {
    description: { type: String, trim: true, default: "" },
    hsCode: { type: String, trim: true, default: "" },
    unitType: { type: String, trim: true, default: "PCS" },
    quantity: { type: Number, min: 0, default: 0 },
    unitRateMinor: { type: Number, min: 0, default: 0 },
    amountMinor: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const boxSchema = new mongoose.Schema<ITaxInvoiceBox>(
  {
    boxNumber: { type: String, trim: true, default: "" },
    dimensions: {
      length: { type: Number, min: 0, default: null },
      width: { type: Number, min: 0, default: null },
      height: { type: Number, min: 0, default: null },
      unit: { type: String, trim: true, default: "cm" }
    },
    actualWeight: { type: Number, min: 0, default: null },
    weightUnit: { type: String, trim: true, default: "kg" },
    items: { type: [itemSchema], default: [] }
  },
  { _id: false }
);

const taxSummarySchema = new mongoose.Schema<ITaxInvoiceTaxSummary>(
  {
    hsnSac: { type: String, trim: true, default: "" },
    gstType: { type: String, enum: ["CGST", "SGST", "IGST", "UTGST"], default: "IGST" },
    taxableValueMinor: { type: Number, min: 0, default: 0 },
    gstRatePercent: { type: Number, min: 0, default: 0 },
    igstAmountMinor: { type: Number, min: 0, default: 0 },
    totalTaxAmountMinor: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const taxInvoiceSchema = new mongoose.Schema<ITaxInvoice>(
  {
    invoiceNumber: { type: String, required: true, trim: true, unique: true, index: true },
    invoiceDate: { type: Date, required: true },
    otherReference: { type: String, trim: true, default: "" },
    paymentTerms: { type: String, trim: true, default: "" },
    buyerOrderNumber: { type: String, trim: true, default: "" },
    dispatchDocumentNumber: { type: String, trim: true, default: "" },
    dispatchedThrough: { type: String, trim: true, default: "" },
    termsOfDelivery: { type: String, trim: true, default: "" },
    shipperIdType: { type: String, trim: true, default: "" },
    shipperIdNumber: { type: String, trim: true, default: "" },
    shipper: { type: partySchema, default: () => ({}) },
    consignee: { type: partySchema, default: () => ({}) },
    countryOfOrigin: { type: String, trim: true, default: "" },
    destinationCountry: { type: String, trim: true, default: "" },
    declarationNote: { type: String, trim: true, default: "" },
    currency: { type: String, trim: true, uppercase: true, default: "INR" },
    boxes: { type: [boxSchema], default: [] },
    taxSummary: { type: [taxSummarySchema], default: [] },
    subTotalMinor: { type: Number, min: 0, default: 0 },
    totalTaxAmountMinor: { type: Number, min: 0, default: 0 },
    totalAmountMinor: { type: Number, min: 0, default: 0 },
    amountInWords: { type: String, trim: true, default: "" },
    taxAmountInWords: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["DRAFT", "FINALIZED"], default: "DRAFT", index: true },
    finalizedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

export const TaxInvoice = mongoose.model<ITaxInvoice>("TaxInvoice", taxInvoiceSchema);
