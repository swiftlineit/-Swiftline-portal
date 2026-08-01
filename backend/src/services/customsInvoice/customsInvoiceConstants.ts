// Constants shared by the customs (shipment) invoice and the shipment draft model.
// Kept in their own file so the model does not have to import the invoice service,
// which would create a circular dependency.

// The declaration note starts empty: staff type whatever the shipment needs, and
// nothing is printed unless they do. Never pre-fill it — an unedited default
// would put a gift declaration on commercial shipments.
export const defaultDeclarationNote = "";

/** Footer line printed on both the PDF and the Excel export. */
export const customsInvoiceFooterNote =
  "This is a computer generated invoice from Swiftline Portal.";

/** Prefix for customs invoice numbers, e.g. SLS/26-27/00001. */
export const customsInvoiceNumberPrefix = "SLS";
