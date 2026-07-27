import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(5000),

  CLIENT_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),
  // Set true when the frontend and API are served from different origins over HTTPS
  // (e.g. two devtunnel subdomains), so the refresh cookie uses SameSite=None; Secure.
  CROSS_SITE_COOKIES: booleanFromEnv.default(false),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required for signing tokens"),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: booleanFromEnv.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  IDEAL_POSTCODES_API_KEY: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  GOOGLE_ADDRESS_VALIDATION_API_KEY: z.string().optional(),
  DPD_MODE: z.enum(["SIMULATED", "LIVE"]).default("SIMULATED"),
  DPD_API_BASE_URL: z.string().url().optional(),
  DPD_API_TOKEN: z.string().optional(),
  DPD_USERNAME: z.string().optional(),
  DPD_PASSWORD: z.string().optional(),
  DPD_ACCOUNT_NUMBER: z.string().optional(),
  DPD_CUSTOMER_ID: z.string().optional(),
  DPD_BUSINESS_UNIT_CODE: z.string().optional(),
  DPD_SENDER_ADDRESS_ID: z.string().optional(),
  DPD_DEPOT_CODE: z.string().optional(),
  DPD_DEFAULT_SERVICE_CODE: z.string().default("DPD_CLASSIC"),
  DPD_TEST_API_BASE_URL: z.string().url().optional(),
  DPD_PRODUCTION_API_BASE_URL: z.string().url().optional(),
  DPD_CREDENTIAL_ENCRYPTION_KEY: z.string().min(32).optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_MIN_TOPUP_MINOR: z.coerce.number().int().positive().default(10000),
  RAZORPAY_MAX_TOPUP_MINOR: z.coerce.number().int().positive().default(10000000),
  CLIENT_DPD_LABEL_CHARGE_MINOR: z.coerce.number().int().nonnegative().default(0)
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");

  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }

  process.exit(1);
}

export const env = result.data;
