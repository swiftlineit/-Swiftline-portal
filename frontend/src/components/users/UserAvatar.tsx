"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { FiUser } from "react-icons/fi";
import { fetchUserProfileImageObjectUrl } from "@/lib/users";

function getInitials(name?: string) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return `${parts[0][0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""}`.toUpperCase();
}

export default function UserAvatar({ userId, name, hasProfileImage, size = 40 }: { userId: string; name?: string; hasProfileImage?: boolean; size?: number }) {
  const [imageUrl, setImageUrl] = useState("");
  const initials = getInitials(name);

  useEffect(() => {
    if (!hasProfileImage) return;
    let active = true;
    let objectUrl = "";
    void fetchUserProfileImageObjectUrl(userId).then((url) => {
      objectUrl = url;
      if (active) setImageUrl(url);
      else URL.revokeObjectURL(url);
    }).catch(() => { if (active) setImageUrl(""); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasProfileImage, userId]);

  return (
    <span style={{ width: size, height: size }} className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-bold tracking-wide text-[#0D1282]">
      {imageUrl ? (
        <Image src={imageUrl} alt={`${name || "User"} profile`} fill unoptimized className="object-cover" />
      ) : initials ? initials : <FiUser aria-hidden="true" className="h-4 w-4" />}
    </span>
  );
}
