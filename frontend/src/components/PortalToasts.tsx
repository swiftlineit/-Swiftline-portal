"use client";

import { ToastContainer } from "react-toastify";

export default function PortalToasts() {
  return (
    <ToastContainer
      position="top-right"
      autoClose={3500}
      hideProgressBar
      newestOnTop
      closeOnClick
      pauseOnFocusLoss
      pauseOnHover
      theme="light"
      toastClassName="border border-slate-200 rounded-none shadow-lg text-sm font-medium"
    />
  );
}
