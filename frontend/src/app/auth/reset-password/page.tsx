"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { resetPassword } from "@/lib/auth";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(token ? "" : "Reset token is missing.");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setMessage("");
    setLoading(true);

    try {
      const result = await resetPassword({ token, password, confirmPassword });
      setMessage(result.message);
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(() => router.push("/"), 2000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-800">
          New password
        </label>
        <div className="relative mt-2">
          <input
            id="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            required
            disabled={!token || Boolean(message)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="block w-full border border-gray-200 bg-white px-4 py-3 pr-12 text-sm text-gray-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:bg-gray-50"
          />
          <button
            type="button"
            disabled={!token || Boolean(message)}
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide new password" : "Show new password"}
            aria-pressed={passwordVisible}
            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center text-gray-400 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50"
          >
            {passwordVisible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-800">
          Confirm password
        </label>
        <div className="relative mt-2">
          <input
            id="confirmPassword"
            type={confirmPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            required
            disabled={!token || Boolean(message)}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="block w-full border border-gray-200 bg-white px-4 py-3 pr-12 text-sm text-gray-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:bg-gray-50"
          />
          <button
            type="button"
            disabled={!token || Boolean(message)}
            onClick={() => setConfirmPasswordVisible((visible) => !visible)}
            aria-label={confirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
            aria-pressed={confirmPasswordVisible}
            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center text-gray-400 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50"
          >
            {confirmPasswordVisible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
          </button>
        </div>
      </div>

      {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading || !token || Boolean(message)}
        className="w-full bg-blue-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-900/70"
      >
        {loading ? "Resetting..." : "Reset Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-blue-900 px-4 py-8">
      <section className="w-full max-w-md border border-gray-200 bg-white px-8 py-10 shadow-lg">
        <div className="mb-8 text-center">
          <Image src="/Slogo.png" alt="Swiftline Cargo" width={64} height={64} className="mx-auto mb-4 h-16 w-16 rounded" priority />
          <h1 className="text-2xl font-semibold text-gray-900">Reset Password</h1>
          <p className="mt-2 text-sm text-gray-600">Create a new password for your Swiftline Portal login.</p>
        </div>

        <Suspense fallback={<p className="text-sm text-gray-600">Loading reset link...</p>}>
          <ResetPasswordForm />
        </Suspense>

        <Link href="/" className="mt-6 block text-center text-sm font-medium text-sky-700 hover:underline">
          Back to Sign In
        </Link>
      </section>
    </main>
  );
}
