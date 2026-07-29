// The fixed option lists shared by the business account wizard and the profile
// page, kept in `lib` so both can reach them without pulling in form components.
//
// The backend stores these as free text (see `businessAccountBodySchema`), so a
// record may hold a value that predates this list. Editors must therefore keep an
// unrecognised stored value selectable rather than silently replacing it.

export const departments = [
  "Management",
  "Operations",
  "Logistics",
  "Finance",
  "Procurement",
  "Accounts",
  "Sales",
  "Import and Export",
  "Other"
];

export const industries = [
  "Freight Forwarder",
  "Custom House Agent (CHA)",
  "Broker/Agent",
  "E-commerce",
  "Retail",
  "Manufacturing",
  "Healthcare",
  "Pharmaceuticals",
  "Automotive",
  "Electronics",
  "Fashion and Apparel",
  "Food and Beverage",
  "FMCG",
  "Import and Export",
  "Construction",
  "Agriculture",
  "Chemicals",
  "Information Technology",
  "Professional Services",
  "Other"
];

export const shipmentVolumes = [
  "1-50 shipments",
  "51-200 shipments",
  "201-500 shipments",
  "501-1,000 shipments",
  "1,001-5,000 shipments",
  "More than 5,000 shipments"
];
