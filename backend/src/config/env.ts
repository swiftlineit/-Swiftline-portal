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
  // Selects the outbound transport. "ses" in production, "smtp" for a local
  // Mailhog, "noop" for tests and for any environment that must never send.
  MAIL_DRIVER: z.enum(["ses", "smtp", "noop"]).default("smtp"),
  MAIL_REPLY_TO: z.string().optional(),
  // Outside production the dispatcher refuses to deliver to anything not listed
  // here. Comma-separated addresses or "@domain.com" suffixes. Enforced in code
  // rather than by configuration discipline: staging must not be one typo away
  // from emailing real clients.
  MAIL_SAFELIST: z.string().optional(),
  AWS_REGION: z.string().default("ap-south-1"),
  // Omit both on EC2/ECS so the SDK falls back to the instance role.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),
  // Shared secret appended to the SNS subscription URL as ?token=. SNS cannot
  // send custom headers, so the query string is the only channel available.
  SES_WEBHOOK_SECRET: z.string().optional(),
  // SES caps a message at 10 MB after base64 encoding. Staying under it means
  // budgeting for the ~33% encoding overhead on the raw attachment bytes.
  EMAIL_MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(7 * 1024 * 1024),
  EMAIL_DRAIN_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
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
  // Ceiling on how much a business account may push through Razorpay in one IST
  // day. Defaults to 5,00,000 rupees.
  RAZORPAY_MAX_DAILY_TOPUP_MINOR: z.coerce.number().int().positive().default(50000000),
  // How long an unpaid order still counts against the daily total. Without this
  // an abandoned checkout would hold its share of the allowance until midnight.
  RAZORPAY_TOPUP_PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  CLIENT_DPD_LABEL_CHARGE_MINOR: z.coerce.number().int().nonnegative().default(0),
  // "Sign in with Google" verifies the ID token's audience against this client ID.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  // reCAPTCHA v3 siteverify secret for the email/password login form.
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  RECAPTCHA_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5)
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
