export type RegistrationRule = {
  info: string;
  maxLength: number;
  message: string;
  validate: (value: string) => boolean;
};

function compact(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function getPrimaryRegistrationRule(country: string, registrationIdType?: string): RegistrationRule | null {
  if (country === "United Kingdom") {
    return {
      info: "CRID format: 8 digits or 2 letters followed by 6 digits, e.g. 01234567 or SC012345.",
      maxLength: 8,
      message: "Enter a valid CRID: 8 digits or 2 letters followed by 6 digits.",
      validate: (value) => /^(\d{8}|[A-Z]{2}\d{6})$/.test(compact(value))
    };
  }

  if (country === "India") {
    return {
      info: "PAN format: 10 characters, 5 letters + 4 digits + 1 letter.",
      maxLength: 10,
      message: "Enter a valid PAN, for example ABCDE1234F.",
      validate: (value) => /^[A-Z]{5}\d{4}[A-Z]$/.test(compact(value))
    };
  }

  if (country === "France") {
    return {
      info: "French VAT format: FR + 2 digit key + 9 digit SIREN, e.g. FR12123456789.",
      maxLength: 15,
      message: "Enter a valid French VAT number, for example FR12123456789.",
      validate: (value) => /^FR\d{11}$/.test(compact(value))
    };
  }

  if (country === "Netherlands") {
    return {
      info: "Dutch VAT format: NL123456789B01 or 112234567B01.",
      maxLength: 14,
      message: "Enter a valid Dutch VAT number, for example NL123456789B01.",
      validate: (value) => /^(NL)?\d{9}B\d{2}$/.test(compact(value))
    };
  }

  if (country === "Canada") {
    const isBusinessNumber = registrationIdType === "business_number";

    return {
      info: isBusinessNumber
        ? "CRA Business Number format: exactly 9 digits."
        : "Canadian registry, corporation, or Quebec enterprise number format: exactly 10 digits.",
      maxLength: isBusinessNumber ? 9 : 10,
      message: isBusinessNumber
        ? "Enter a valid CRA Business Number: exactly 9 digits."
        : "Enter a valid Canadian registration number: exactly 10 digits.",
      validate: (value) => new RegExp(`^\\d{${isBusinessNumber ? 9 : 10}}$`).test(compact(value))
    };
  }

  if (country === "Switzerland") {
    return {
      info: "Swiss UID format: CHE-XXX.XXX.XXX.",
      maxLength: 15,
      message: "Enter a valid Swiss UID, for example CHE-123.456.789.",
      validate: (value) => /^CHE-\d{3}\.\d{3}\.\d{3}$/.test(compact(value))
    };
  }

  if (country === "Poland") {
    return {
      info: "Polish NIP/VAT format: PL + 10 digits, or just 10 digits.",
      maxLength: 12,
      message: "Enter a valid Polish VAT/NIP, for example PL1234567890 or 1234567890.",
      validate: (value) => /^(PL)?\d{10}$/.test(compact(value))
    };
  }

  return null;
}

export function getSecondaryRegistrationRule(country: string): RegistrationRule | null {
  if (country === "France") {
    return {
      info: "SIREN format: 9 digits, often shown as 123 456 789.",
      maxLength: 11,
      message: "Enter a valid SIREN: exactly 9 digits.",
      validate: (value) => /^\d{9}$/.test(compact(value))
    };
  }

  if (country === "Netherlands") {
    return {
      info: "KVK number format: exactly 8 digits.",
      maxLength: 8,
      message: "Enter a valid KVK number: exactly 8 digits.",
      validate: (value) => /^\d{8}$/.test(compact(value))
    };
  }

  return null;
}
