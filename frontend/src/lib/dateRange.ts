export type DateRange = { from: string; to: string };

export const emptyDateRange: DateRange = { from: "", to: "" };

/**
 * Adds the from/to bounds every list endpoint expects. Either side may be empty,
 * which leaves that end of the range open.
 */
export function setDateRangeParams(params: URLSearchParams, range?: DateRange) {
  if (range?.from) params.set("dateFrom", range.from);
  if (range?.to) params.set("dateTo", range.to);
}

/** Formats a Date as the "YYYY-MM-DD" day string the range params use. */
export function toRangeDay(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}
