export const prepaidCurrencyValues = ["INR"] as const;
export type PrepaidCurrency = (typeof prepaidCurrencyValues)[number];

export const paymentSourceValues = ["BUSINESS_ACCOUNT", "CLIENT_PREPAID", "ADMIN_DIRECT", "TEST"] as const;
export type PaymentSource = (typeof paymentSourceValues)[number];

export const shippingEnvironmentValues = ["MOCK", "PREPRODUCTION", "PRODUCTION"] as const;
export type ShippingEnvironment = (typeof shippingEnvironmentValues)[number];

export const maxCreditLimitRupees = 100_000;
export const maxCreditLimitMinor = maxCreditLimitRupees * 100;

export function isMinorUnitInteger(value: unknown) {
  return Number.isInteger(value);
}
