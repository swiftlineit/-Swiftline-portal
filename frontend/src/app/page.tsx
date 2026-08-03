"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Script from "next/script";
import { apiUrl } from "@/lib/api";
import { loginWithGoogle, setAccessToken, takeSessionEndedReason } from "@/lib/auth";
import Link from "next/link";
import { FiEye, FiEyeOff } from "react-icons/fi";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

function getSafeInternalDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

/** Same post-login destination rule for both the password and Google sign-in paths. */
function destinationFor(role: string | undefined) {
  const requestedDestination = getSafeInternalDestination(new URLSearchParams(window.location.search).get("next"));
  return role === "client" ? "/client/dashboard" : requestedDestination || "/dashboard";
}

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  // Read once, during the initial state, from whatever ended the previous
  // session — so the reason is on screen in the same paint the user lands on.
  // An unexplained bounce back to the login form reads as a bug.
  const [sessionEndedNotice] = useState(() => takeSessionEndedReason());
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setError("");
    setLoading(true);
    try {
      const data = await loginWithGoogle(credential);
      setAccessToken(data.accessToken);
      router.push(destinationFor(data.user?.role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in with Google.");
      setLoading(false);
    }
  }, [router]);

  // Runs once the Google Identity Services script has loaded and rendered the button.
  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || !googleButtonRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => void handleGoogleCredential(response.credential)
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      width: 380,
      text: "signin_with"
     
    });
  }, [googleReady, handleGoogleCredential]);

  async function getRecaptchaToken(): Promise<string | undefined> {
    if (!RECAPTCHA_SITE_KEY || !window.grecaptcha) return undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        window.grecaptcha!.ready(() => {
          window.grecaptcha!.execute(RECAPTCHA_SITE_KEY, { action: "login" }).then(resolve, reject);
        });
      });
    } catch {
      // Fails open to match the backend: a captcha script/network hiccup shouldn't
      // block a legitimate login attempt.
      return undefined;
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!acceptedPolicy) {
      setError("Please accept the terms and conditions to continue.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const recaptchaToken = await getRecaptchaToken();
      const response = await fetch(apiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, termsAccepted: acceptedPolicy, recaptchaToken })
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.message || "Invalid credentials");
        setLoading(false);
        return;
      }

      setAccessToken(data.accessToken);
      router.push(destinationFor(data.user?.role));
    } catch {
      setError("Unable to sign in. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#0D1282] px-12 py-16 text-white lg:flex lg:flex-col justify-center align-middle">
        {/* static texture, no motion */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]" aria-hidden="true">
          <defs>
            <pattern id="dotgrid" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dotgrid)" />
        </svg>
        <div className="pointer-events-none absolute  h-96 w-96 rounded-full bg-[#F5B942]/15 blur-3xl" />

        <div className="">
          {/* <Image
            src="/logo.svg"
            alt="Swiftline Cargo"
            width={44}
            height={44}
            className="h-11 w-11 rounded-lg"
            priority
          /> */}
        </div>

        <div className="relative mt-10 p-20 text-center">
          <p className="text-8xl  leading-[0.8] text-start  tracking-wider text-white/95">
            Swiftline
            <span className="text-[#F5B942] text-5xl block tracking-wide  text-start mt-5 pl-1 " >Cargo & Logistics . </span>
          </p>
          
           <p className="text-lg mt-3 text-start capitalize text-white/70">
           Every parcel a promise, swiftly delivered.
          </p>
       
          <p className="mt-16  text-[15px]  pr-20 text-start  text-white">
        Welcome to the Swiftline Cargo Portal—your centralized command center for logistics operations. Manage shipments, generate manifests, monitor tracking updates, oversee business accounts, and streamline day-to-day workflows with a secure, scalable platform built to deliver speed, accuracy, and complete operational visibility.
          </p>
          <p className="mt-4 text-xs text-start uppercase tracking-[0.3em] text-white">
            Swiftline Cargo Portal
          </p>
        </div>

     
{/* 
        <div className="relative flex items-center gap-5 border-t border-white/10 pt-4">
          <div className="flex-1">
            <b className="block font-mono text-[19px] font-semibold text-white">120+</b>
            <small className="mt-0.5 block text-[9.5px]  uppercase tracking-[0.09em] text-white/45">Countries served</small>
          </div>
          <div className="h-6 w-px bg-white/15" />
          <div className="flex-1">
            <b className="block font-mono text-[19px] font-semibold text-white">24/7</b>
            <small className="mt-0.5 block text-[9.5px]  uppercase tracking-[0.09em] text-white/45">Live tracking</small>
          </div>
          <div className="h-6 w-px bg-white/15" />
          <div className="flex-1">
            <b className="block font-mono text-[19px] font-semibold text-white">48h</b>
            <small className="mt-0.5 block text-[9.5px]  uppercase tracking-[0.09em] text-white/45">Avg. customs clearance</small>
          </div>
        </div> */}

        
      </div>

      {/* Form panel */}
      <div className="flex min-h-screen items-center justify-center px-6 py-16 lg:px-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Image
              src="/logo.svg"
              alt="Swiftline Cargo"
              width={48}
              height={48}
              className="mb-4 h-12 w-12 rounded-lg"
              priority
            />
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Login to access the Swiftline Cargo portal.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm  text-gray-800"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 block w-full border-0 border-b-2 border-gray-200 bg-transparent px-1 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#F5B942]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="password"
                  className="block text-sm  text-gray-800"
                >
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-sm  text-[#0D1282] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative mt-2">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="block w-full border-0 border-b-2 border-gray-200 bg-transparent px-1 py-2.5 pr-8 text-sm text-gray-900 outline-none transition focus:border-[#F5B942]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-gray-400 outline-none transition hover:text-gray-600 focus-visible:text-[#0D1282]"
                >
                  {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="acceptedPolicy"
                name="acceptedPolicy"
                type="checkbox"
                checked={acceptedPolicy}
                onChange={(event) => setAcceptedPolicy(event.target.checked)}
                className=" h-4 w-4 rounded border-gray-300 text-[#0D1282] focus:ring-[#0D1282]/40"
              />
              <label htmlFor="acceptedPolicy" className="text-sm text-gray-600">
                I accept the privacy policy and terms.{" "}
                <Link
                  href="/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#0D1282] hover:underline"
                >
                  Read here
                </Link>
                .
              </label>
            </div>

            {sessionEndedNotice ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                {sessionEndedNotice}
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#0D1282] px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-[#0D1282]/20 transition hover:bg-[#0D1282]/90 focus:outline-none focus:ring-2 focus:ring-[#F5B942]/60 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#0D1282]/60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {GOOGLE_CLIENT_ID ? (
            <>
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs uppercase tracking-wide text-gray-400">Or</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <div ref={googleButtonRef} className="flex justify-center" />
            </>
          ) : null}
        </div>
      </div>

      {GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleReady(true)}
        />
      ) : null}
      {RECAPTCHA_SITE_KEY ? (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      ) : null}
    </div>
  );
}