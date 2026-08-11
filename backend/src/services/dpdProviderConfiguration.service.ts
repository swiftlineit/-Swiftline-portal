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
  als: {
    companyId?: number;
    email?: string;
    password?: string;
    serviceCode: string;
    inrPerGbp?: number;
  };
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
    als: {
      companyId: env.ALS_COMPANY_ID,
      email: env.ALS_API_EMAIL,
      password: env.ALS_API_PASSWORD,
      serviceCode: env.ALS_SERVICE_CODE,
      inrPerGbp: env.ALS_INR_PER_GBP
    },
    credentials: {
      apiToken: env.DPD_API_TOKEN,
      username: env.DPD_USERNAME,
      password: env.DPD_PASSWORD,
      accountNumber: env.DPD_ACCOUNT_NUMBER
    }
  };

  if (mode === "LIVE") {
    const missing = [
      !env.ALS_API_BASE_URL && "ALS_API_BASE_URL",
      !configuration.als.companyId && "ALS_COMPANY_ID",
      !configuration.als.email && "ALS_API_EMAIL",
      !configuration.als.password && "ALS_API_PASSWORD",
      !configuration.als.inrPerGbp && "ALS_INR_PER_GBP"
    ].filter(Boolean);

    configuration.apiBaseUrl = env.ALS_API_BASE_URL ?? "";
    configuration.businessUnitCode = configuration.businessUnitCode || "ALS";
    configuration.customerId = configuration.customerId || "ALS-AUTH";
    configuration.senderAddressId = configuration.senderAddressId || "ALS-CONSIGNOR";

    if (missing.length) {
      throw new DpdProviderConfigurationError(
        `Live ALS booking is unavailable because these server settings are missing: ${missing.join(", ")}.`
      );
    }
  }

  return configuration;
}
