import { env } from "../config/env.js";

type SiteverifyResponse = {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

/**
 * Verifies a reCAPTCHA v3 token against Google's siteverify endpoint.
 *
 * Fails open: if RECAPTCHA_SECRET_KEY isn't configured, or siteverify itself
 * errors/times out, the login is allowed through (logged, not blocked) - a
 * Google-side outage shouldn't lock every user out of the portal. The score
 * cutoff is only enforced when siteverify actually answers.
 */
export async function verifyRecaptcha(token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (!env.RECAPTCHA_SECRET_KEY) return true;
  if (!token) {
    console.warn("reCAPTCHA token missing on login attempt; allowing through (fail-open).");
    return true;
  }

  try {
    const params = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token });
    if (remoteIp) params.set("remoteip", remoteIp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let result: SiteverifyResponse;
    try {
      const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal
      });
      result = await response.json() as SiteverifyResponse;
    } finally {
      clearTimeout(timeout);
    }

    if (!result.success) {
      console.warn("reCAPTCHA verification failed.", { errors: result["error-codes"] });
      return false;
    }
    if (typeof result.score === "number" && result.score < env.RECAPTCHA_MIN_SCORE) {
      console.warn("reCAPTCHA score below threshold.", { score: result.score });
      return false;
    }
    return true;
  } catch (error) {
    console.error("reCAPTCHA siteverify request failed; allowing login through (fail-open).", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return true;
  }
}
