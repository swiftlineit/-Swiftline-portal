// Designation choices offered by the staff form and the staff detail page.
//
// The server stores designation as free text, so this list shapes the UI without
// locking the data: picking "Other" reveals a text box for a title that is not
// listed yet, and an older record holding an unlisted value still displays.

export const OTHER_DESIGNATION = "Other";

export const staffDesignations = [
  "Operations Executive",
  "Operations Manager",
  "Warehouse Executive",
  "Delivery Executive",
  "Delivery Supervisor",
  "Accounts Executive",
  "Accounts Manager",
  "Finance Manager",
  "HR Executive",
  "HR Manager",
  "Customer Support Executive",
  "Branch Manager"
] as const;

export const designationOptions = [
  ...staffDesignations.map((designation) => ({ value: designation, label: designation })),
  { value: OTHER_DESIGNATION, label: "Other (type a title)" }
];

export function isListedDesignation(value: string) {
  return (staffDesignations as readonly string[]).includes(value);
}
