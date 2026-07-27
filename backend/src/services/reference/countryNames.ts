// ISO-3166 alpha-2 → the UPPERCASE country name the customs EDI expects. Verified
// against the sample EDI: IN→INDIA, GB→UNITED KINGDOM, DE→GERMANY, GR→GREECE, and
// US→UNITED STATES OF AMERICA (not "UNITED STATES"). Unknown inputs fall through
// uppercased, so a value that is already a full name passes cleanly.

const iso2ToName: Record<string, string> = {
  IN: "INDIA",
  GB: "UNITED KINGDOM",
  US: "UNITED STATES OF AMERICA",
  DE: "GERMANY",
  GR: "GREECE",
  ES: "SPAIN",
  PT: "PORTUGAL",
  FR: "FRANCE",
  IT: "ITALY",
  NL: "NETHERLANDS",
  BE: "BELGIUM",
  IE: "IRELAND",
  AT: "AUSTRIA",
  CH: "SWITZERLAND",
  SE: "SWEDEN",
  NO: "NORWAY",
  DK: "DENMARK",
  FI: "FINLAND",
  PL: "POLAND",
  CZ: "CZECH REPUBLIC",
  HU: "HUNGARY",
  RO: "ROMANIA",
  BG: "BULGARIA",
  HR: "CROATIA",
  SK: "SLOVAKIA",
  SI: "SLOVENIA",
  LT: "LITHUANIA",
  LV: "LATVIA",
  EE: "ESTONIA",
  LU: "LUXEMBOURG",
  MT: "MALTA",
  CY: "CYPRUS",
  CA: "CANADA",
  AU: "AUSTRALIA",
  NZ: "NEW ZEALAND",
  AE: "UNITED ARAB EMIRATES",
  SA: "SAUDI ARABIA",
  QA: "QATAR",
  KW: "KUWAIT",
  BH: "BAHRAIN",
  OM: "OMAN",
  SG: "SINGAPORE",
  MY: "MALAYSIA",
  TH: "THAILAND",
  JP: "JAPAN",
  CN: "CHINA",
  HK: "HONG KONG",
  ZA: "SOUTH AFRICA",
  KE: "KENYA",
  NG: "NIGERIA",
  MU: "MAURITIUS"
};

/** Maps an ISO-2 code (or an already-full name) to the EDI's UPPERCASE country name. */
export function ediCountryName(codeOrName: unknown): string {
  const value = typeof codeOrName === "string" ? codeOrName.trim().toUpperCase() : "";
  if (!value) return "";
  if (value.length === 2 && iso2ToName[value]) return iso2ToName[value]!;
  return value;
}
