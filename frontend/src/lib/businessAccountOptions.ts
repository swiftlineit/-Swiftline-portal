// The fixed option lists shared by the business account wizard and the profile
// page, kept in `lib` so both can reach them without pulling in form components.
//
// The backend stores these as free text (see `businessAccountBodySchema`), so a
// record may hold a value that predates this list. Editors must therefore keep an
// unrecognised stored value selectable rather than silently replacing it.

export const OTHER_JOB_TITLE = "Other";

// Ordered by seniority as supplied by the business, not alphabetically, so the
// common senior titles sit at the top of the list rather than being scattered.
export const jobTitles = [
  "Owner",
  "Founder",
  "Co-Founder",
  "Director",
  "Managing Director",
  "Chief Executive Officer",
  "Chief Financial Officer",
  "Chief Operating Officer",
  "General Manager",
  "Branch Manager",
  "Operations Manager",
  "Logistics Manager",
  "Export Manager",
  "Import Manager",
  "Finance Manager",
  "Accounts Manager",
  "Sales Manager",
  "Business Development Manager",
  "Customer Service Manager",
  "Warehouse Manager",
  "Compliance Manager",
  "Customs Clearance Manager",
  "Supervisor",
  "Operations Executive",
  "Sales Executive",
  "Accounts Executive",
  "Customer Service Executive",
  "Warehouse Executive",
  "Driver",
  "Courier",
  "Agent",
  "Freight Forwarder",
  "Customs Broker",
  "Administrator"
] as const;

export const jobTitleOptions = [
  ...jobTitles.map((jobTitle) => ({ value: jobTitle, label: jobTitle })),
  { value: OTHER_JOB_TITLE, label: "Other (enter manually)" }
];

export function isListedJobTitle(value: string) {
  return (jobTitles as readonly string[]).includes(value);
}

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
