import { env } from "../config/env.js";

export type DpdProviderMode = "SIMULATED" | "LIVE";

export interface DpdProviderConfiguration {
  mode: DpdProviderMode;
  active: true;
  apiBaseUrl: string;
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode: string;
  defaultServiceCode: string;
  defaultLabelSize: "A6";
  defaultPrintFormat: "PDF";
  credentials: {
    apiToken?: string;
    username?: string;
    password?: string;
    accountNumber?: string;
  };
}

export class DpdProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpdProviderConfigurationError";
  }
}

export function getDpdProviderConfiguration(): DpdProviderConfiguration {
  const mode = env.DPD_MODE;
  const configuration: DpdProviderConfiguration = {
    mode,
    active: true,
    apiBaseUrl: env.DPD_API_BASE_URL ?? "",
    businessUnitCode: env.DPD_BUSINESS_UNIT_CODE ?? (mode === "SIMULATED" ? "TEST" : ""),
    customerId: env.DPD_CUSTOMER_ID ?? (mode === "SIMULATED" ? "TEST-CUSTOMER" : ""),
    senderAddressId: env.DPD_SENDER_ADDRESS_ID ?? (mode === "SIMULATED" ? "TEST-SENDER" : ""),
    depotCode: env.DPD_DEPOT_CODE ?? "",
    defaultServiceCode: env.DPD_DEFAULT_SERVICE_CODE,
    defaultLabelSize: "A6",
    defaultPrintFormat: "PDF",
    credentials: {
      apiToken: env.DPD_API_TOKEN,
      username: env.DPD_USERNAME,
      password: env.DPD_PASSWORD,
      accountNumber: env.DPD_ACCOUNT_NUMBER
    }
  };

  if (mode === "LIVE") {
    const hasCredentials = Boolean(configuration.credentials.apiToken)
      || Boolean(configuration.credentials.username && configuration.credentials.password);
    const missing = [
      !configuration.apiBaseUrl && "DPD_API_BASE_URL",
      !hasCredentials && "DPD_API_TOKEN or DPD_USERNAME/DPD_PASSWORD",
      !configuration.businessUnitCode && "DPD_BUSINESS_UNIT_CODE",
      !configuration.customerId && "DPD_CUSTOMER_ID",
      !configuration.senderAddressId && "DPD_SENDER_ADDRESS_ID"
    ].filter(Boolean);

    if (missing.length) {
      throw new DpdProviderConfigurationError(
        `Live DPD booking is unavailable because these global settings are missing: ${missing.join(", ")}.`
      );
    }
  }

  return configuration;
}
