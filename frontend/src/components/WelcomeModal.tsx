"use client";

import { FiX } from "react-icons/fi";

export default function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="welcome-modal-title" className="text-xl font-semibold text-slate-900">
              Welcome to the Dashboard
            </h3>
           <p className="mt-2 text-sm leading-6 text-slate-600">
  Welcome back! Everything you need to manage your logistics operations is available here.
</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close welcome modal"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          >
            <FiX aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex w-full items-center justify-center rounded bg-blue-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
