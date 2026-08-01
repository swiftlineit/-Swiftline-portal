"use client";

import { useEffect, useState } from "react";

import { fetchBranchFileObjectUrl } from "@/lib/branches";

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
