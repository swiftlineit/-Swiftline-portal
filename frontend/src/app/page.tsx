"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { apiUrl } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!acceptedPolicy) {
      setError("Please accept the terms and conditions to continue.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch(apiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, termsAccepted: acceptedPolicy })
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.message || "Invalid credentials");
        setLoading(false);
        return;
      }

      setAccessToken(data.accessToken);
      router.push(data.user?.role === "client" ? "/client/dashboard" : "/dashboard");
    } catch {
      setError("Unable to sign in. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-900 px-4 py-8 ">
      <div className="w-full max-w-md rounded border border-gray-200 bg-white px-8 py-10 shadow-lg ">
        <div className="mb-8 text-center">
          <Image
            src="/Slogo.png"
            alt="Swiftline Cargo"
            width={64}
            height={64}
            className="mx-auto mb-4 h-16 w-16 rounded"
            priority
          />
          <h1 className="text-2xl font-semibold text-gray-900 ">Welcome Back</h1>
          <p className="mt-2 text-sm text-gray-600">Login to access the Swiftline Cargo portal.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-800 ">
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
              className="mt-2 block w-full  border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="password" className="block text-sm font-medium text-gray-800">
                Password
              </label>
              <Link href="/auth/forgot-password" className="text-sm font-medium text-sky-700 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 block w-full border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-500"
            />
          </div>

          <div className="flex items-start gap-3">
            <input
              id="acceptedPolicy"
              name="acceptedPolicy"
              type="checkbox"
              checked={acceptedPolicy}
              onChange={(event) => setAcceptedPolicy(event.target.checked)}
              className="mt-1 h-4 w-4  border-gray-300 text-sky-600 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <label htmlFor="acceptedPolicy" className="text-sm text-gray-600">
              I accept the privacy policy and terms. <Link href="/privacy-policy" className="text-sky-600 hover:underline">Read here</Link>.
            </label>
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-900/70 dark:focus:ring-offset-slate-950"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
