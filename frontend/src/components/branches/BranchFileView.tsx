"use client";

import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";

import { fetchBranchFileObjectUrl } from "@/lib/branches";
import { useDialog } from "@/lib/useDialog";

// Branch files are served from an authenticated endpoint, so their bytes are
// fetched with a token and exposed to the browser as an object URL. The URL is
// revoked when the path changes or the component unmounts.
function useBranchFileUrl(storedPath: string) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let active = true;

    setUrl("");
    setFailed(false);

    fetchBranchFileObjectUrl(storedPath)
      .then((nextUrl) => {
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setUrl(nextUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storedPath]);

  return { url, failed };
}

export function BranchImage({
  storedPath,
  alt,
  className
}: {
  storedPath: string;
  alt: string;
  className?: string;
}) {
  const { url, failed } = useBranchFileUrl(storedPath);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-[#EEEDED]/60 text-xs font-medium text-slate-400 ${className ?? ""}`}>
        Unavailable
      </div>
    );
  }

  if (!url) {
    return <div className={`animate-pulse bg-[#EEEDED]/60 ${className ?? ""}`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}

export function BranchFileLink({
  storedPath,
  children,
  className
}: {
  storedPath: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { url, failed } = useBranchFileUrl(storedPath);

  if (failed) {
    return <span className={`${className ?? ""} text-slate-400`}>{children}</span>;
  }

  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!url || undefined}
      className={`${className ?? ""} ${url ? "" : "pointer-events-none opacity-60"}`}
    >
      {children}
    </a>
  );
}

// Inline preview of a stored branch file (image or PDF) inside a modal. Only
// rendered while open, so the bytes are fetched on mount and released on close.
export function BranchFileModal({
  storedPath,
  fileName,
  title,
  onClose
}: {
  storedPath: string;
  fileName: string;
  title?: string;
  onClose: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let active = true;

    fetchBranchFileObjectUrl(storedPath)
      .then((nextUrl) => {
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setUrl(nextUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storedPath]);

  const isPdf = fileName.toLowerCase().endsWith(".pdf");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D1282]/70 px-4 py-6 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? fileName}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-[#0D1282]">{title ?? fileName}</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-[#EEEDED]/60 hover:text-[#0D1282]"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#EEEDED]/40 p-5">
          {failed ? (
            <p className="py-10 text-center text-sm font-semibold text-slate-500">
              Unable to load file.
            </p>
          ) : !url ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading...</p>
          ) : isPdf ? (
            <iframe
              src={url}
              title={title ?? fileName}
              className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={title ?? fileName}
              className="mx-auto max-h-[70vh] w-auto rounded-lg border border-slate-200 bg-white object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
