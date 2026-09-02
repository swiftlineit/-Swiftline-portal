export function normalizeFlightNumber(value: string) {
  const upper = value.trim().toUpperCase();
  const compact = upper.replace(/[\s-]+/g, "");
  const match = /^([A-Z]{2,4})(\d{1,4}[A-Z]?)$/.exec(compact);
  return match ? `${match[1]}-${match[2]}` : upper;
}
